import { DateTime } from 'luxon';
import { CalcError, type EvalContext, type HighlightSpan, type LineResult, type Quantity, type RateProvider } from './types';
import { tokenize } from './tokenizer';
import { parseTokens, KEYWORDS } from './parser';
import { evaluate } from './evaluator';
import { formatQuantity } from './format';
import { runIntents, expressionFallback } from './nl/intents';
import { SOURCE_WORDS, CANON_KEYWORDS } from './nl/normalize';
import { isUnitWord } from './units';
import { isCurrencyWord } from './currency';
import { isZoneWord } from './timezone';

export * from './types';
export { formatQuantity } from './format';
export { tokenize } from './tokenizer';
export * from './history';

export interface DocumentOptions {
  rates: RateProvider;
  now?: () => DateTime;
  zone?: string;
}

export const noRates: RateProvider = { get: () => null };

const LABEL_RE = /^(\s*)([\p{L}][\p{L}\p{N}_ '’.-]*?)\s*:\s*(.*)$/u;
const ASSIGN_RE = /^(\s*)([\p{L}_][\p{L}\p{N}_]*)\s*=(?!=)\s*(.*)$/u;

function highlight(text: string, label: { start: number; end: number } | null, variables: Set<string>, comments: { start: number; end: number }[]): HighlightSpan[] {
  const spans: HighlightSpan[] = [];
  if (label) spans.push({ start: label.start, end: label.end, cls: 'label' });
  const inComment = (s: number) => comments.some((c) => s >= c.start && s < c.end);
  for (const c of comments) spans.push({ start: c.start, end: c.end, cls: 'comment' });
  const toks = tokenize(text);
  for (const t of toks) {
    if (label && t.start < label.end) continue;
    if (inComment(t.start)) continue;
    if (t.type === 'number' || t.type === 'currency') spans.push({ start: t.start, end: t.end, cls: 'number' });
    else if (t.type === 'percent') spans.push({ start: t.start, end: t.end, cls: 'number' });
    else if (t.type === 'op' || t.type === 'paren') spans.push({ start: t.start, end: t.end, cls: 'op' });
    else if (t.type === 'word') {
      const v = t.value;
      if (variables.has(v)) spans.push({ start: t.start, end: t.end, cls: 'variable' });
      else if (isUnitWord(v) || isCurrencyWord(v) || isZoneWord(v)) spans.push({ start: t.start, end: t.end, cls: 'unit' });
      else if (KEYWORDS.has(v) || CANON_KEYWORDS.has(v) || SOURCE_WORDS.has(v) || v === 'percent') spans.push({ start: t.start, end: t.end, cls: 'keyword' });
      else spans.push({ start: t.start, end: t.end, cls: 'text' });
    }
  }
  return spans.sort((a, b) => a.start - b.start);
}

/** Strip "quoted" inline comments (Numi convention) and return their ranges. */
function stripQuotes(text: string): { clean: string; comments: { start: number; end: number }[] } {
  const comments: { start: number; end: number }[] = [];
  let clean = text;
  const re = /"[^"]*"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    comments.push({ start: m.index, end: m.index + m[0].length });
    clean = clean.slice(0, m.index) + ' '.repeat(m[0].length) + clean.slice(m.index + m[0].length);
  }
  return { clean, comments };
}

function looksLikeText(text: string): boolean {
  // no digits, no currency symbols, no operators → plain prose
  return !/[\d$₹€£¥৳+\-*/^%=()]/.test(text) && !/\b(sum|total|avg|average|prev|ans|today|tomorrow|yesterday|now|time|next|last)\b/i.test(text);
}

export function evaluateLine(rawText: string, ctx: EvalContext, variables: Set<string>): LineResult {
  const trimmed = rawText.trim();
  if (trimmed === '') return { ok: false, display: '', isText: true, spans: [] };
  if (trimmed.startsWith('//')) return { ok: false, display: '', isText: true, spans: [{ start: 0, end: rawText.length, cls: 'comment' }] };
  if (trimmed.startsWith('#')) return { ok: false, display: '', isText: true, spans: [{ start: 0, end: rawText.length, cls: 'label' }] };

  let label: string | undefined;
  let labelRange: { start: number; end: number } | null = null;
  let body = rawText;
  let bodyOffset = 0;
  let isAssignment = false;

  const lm = LABEL_RE.exec(rawText);
  if (lm && !/^\d/.test(lm[2])) {
    label = lm[2].trim();
    labelRange = { start: lm[1].length, end: lm[1].length + lm[2].length + 1 };
    bodyOffset = rawText.length - lm[3].length;
    body = lm[3];
    isAssignment = /^[\p{L}][\p{L}\p{N} _]*$/u.test(label) && label.split(/\s+/).length <= 4;
  } else {
    const am = ASSIGN_RE.exec(rawText);
    if (am) {
      label = am[2];
      labelRange = { start: am[1].length, end: am[1].length + am[2].length };
      bodyOffset = rawText.length - am[3].length;
      body = am[3];
      isAssignment = true;
    }
  }

  const { clean, comments } = stripQuotes(body);
  const commentRanges = comments.map((c) => ({ start: c.start + bodyOffset, end: c.end + bodyOffset }));
  const spans = highlight(rawText, labelRange, variables, commentRanges);
  const labelKey = isAssignment && label ? label.toLowerCase().replace(/\s+/g, ' ') : undefined;

  if (clean.trim() === '') {
    return { ok: false, display: '', isText: true, label: labelKey, spans };
  }

  const parseOpts = { variables, now: ctx.now(), zone: ctx.zone };
  let value: Quantity | undefined;
  let firstError: CalcError | undefined;

  // 1. plain expression
  try {
    value = evaluate(parseTokens(tokenize(clean), parseOpts), ctx);
  } catch (e) {
    if (e instanceof CalcError) firstError = e;
    else firstError = new CalcError(String((e as Error).message ?? e));
  }
  // 2. natural-language intents
  let intentError: CalcError | undefined;
  if (!value) {
    try {
      value = runIntents(clean, ctx) ?? undefined;
    } catch (e) {
      if (e instanceof CalcError) intentError = e;
      else intentError = new CalcError(String((e as Error).message ?? e));
    }
  }
  // 3. stripped expression fallback
  if (!value && !intentError) {
    const fb = expressionFallback(clean);
    if (fb && fb !== clean.trim().toLowerCase()) {
      try {
        value = evaluate(parseTokens(tokenize(fb), parseOpts), ctx);
      } catch {
        /* keep first error */
      }
    }
  }

  if (value) {
    return { ok: true, value, display: formatQuantity(value), note: value.note, isText: false, label: labelKey, spans };
  }
  const err = intentError ?? firstError;
  if (looksLikeText(clean) && !intentError) {
    return { ok: false, display: '', isText: true, label: labelKey, spans };
  }
  const hint = err?.hint ? `${err.message} · ${err.hint}` : (err?.message ?? 'error');
  return { ok: false, display: '', note: hint, isText: false, label: labelKey, spans };
}

export function evaluateDocument(lines: string[], opts: DocumentOptions): LineResult[] {
  const zone = opts.zone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC';
  const now = opts.now ?? (() => DateTime.now().setZone(zone));
  const variables = new Map<string, Quantity>();
  const previous: (Quantity | null)[] = [];
  let block: Quantity[] = [];
  const results: LineResult[] = [];
  for (const line of lines) {
    if (line.trim() === '') {
      block = [];
      previous.push(null);
      results.push({ ok: false, display: '', isText: true, spans: [] });
      continue;
    }
    const ctx: EvalContext = { variables, previous, block, rates: opts.rates, now, zone };
    const r = evaluateLine(line, ctx, new Set(variables.keys()));
    results.push(r);
    previous.push(r.ok ? r.value! : null);
    if (r.ok) {
      block.push(r.value!);
      if (r.label) variables.set(r.label, r.value!);
    }
  }
  return results;
}
