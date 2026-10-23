import { DateTime } from 'luxon';
import { CalcError, Decimal, type EvalContext, type HighlightSpan, type LineResult, type Quantity, type RateProvider, own } from './types';
import { tokenize } from './tokenizer';
import { parseTokens, KEYWORDS, SCALES } from './parser';
import { evaluate } from './evaluator';
import { formatQuantity } from './format';
import { runIntents, expressionFallback } from './nl/intents';
import { SOURCE_WORDS, CANON_KEYWORDS, normalize } from './nl/normalize';
import { isUnitWord } from './units';
import { isCurrencyWord, findCurrency } from './currency';
import { formatNumber } from './format';
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

// a label's colon is followed by a space or ends the line ("Price: $10"); "5:30pm" and "3:4" are not labels
const LABEL_RE = /^(\s*)([\p{L}][\p{L}\p{N}_ '’.-]*?)\s*:(?:\s+|$)(.*)$/u;
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
  if (isResetLine(trimmed)) {
    return { ok: false, display: '', note: 'context cleared', isText: true, resetsContext: true, spans: [{ start: 0, end: rawText.length, cls: 'keyword' }] };
  }
  // "… offline" / "cached rate": never present a rate as live on this line
  ctx.cachedOnly = /\b(offline|cached|cache)\b/i.test(trimmed);
  // mixed-currency sums are only allowed when the line says which currency it wants ("sum in USD - 4%")
  ctx.allowMixedCurrency = currencyNamed(trimmed);

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

  const { clean: cleanRaw, comments } = stripQuotes(body);
  // a sentence-ending period/question mark is punctuation, not part of the expression ("1000 + 10%.")
  // ("5!" is a factorial, so "!" only counts as punctuation after a letter or space)
  const { text: clean, places: roundTo } = extractRounding(cleanRaw.replace(/[.?]+\s*$/, '').replace(/(?<=[\p{L}\s])!+\s*$/u, ''));
  const commentRanges = comments.map((c) => ({ start: c.start + bodyOffset, end: c.end + bodyOffset }));
  let labelKey = isAssignment && label ? label.toLowerCase().replace(/\s+/g, ' ') : undefined;
  const spans = () => highlight(rawText, labelRange, variables, commentRanges);

  if (clean.trim() === '') {
    return { ok: false, display: '', isText: true, label: labelKey, spans: spans() };
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
  // the expression parsed but needed data (a rate, a currency target): report that, never re-read it as prose
  if (!value && firstError?.kind === 'data') {
    return { ok: false, display: '', note: firstError.hint ? `${firstError.message} · ${firstError.hint}` : firstError.message, isText: false, label: labelKey, spans: spans() };
  }
  // 1b. implicit definition: "rahul Rs 100", "rent 15000", "coffee $4.5" → name = value (context from visible lines)
  if (!value && !label) {
    const def = tryImplicitDefinition(clean, parseOpts, ctx, variables);
    if (def) {
      value = def.value;
      labelKey = def.name;
      labelRange = { start: def.start + bodyOffset, end: def.end + bodyOffset };
    }
  }
  // 2. natural-language intents
  let intentError: CalcError | undefined;
  let defines: Record<string, Quantity> | undefined;
  if (!value) {
    try {
      const r = runIntents(clean, ctx);
      if (r) {
        value = r;
        defines = r.defines;
      }
    } catch (e) {
      if (e instanceof CalcError) intentError = e;
      else intentError = new CalcError(String((e as Error).message ?? e));
    }
  }
  // 3. stripped expression fallback
  if (!value && !intentError) {
    const fb = expressionFallback(clean, ctx);
    if (fb && fb !== clean.trim().toLowerCase()) {
      try {
        value = evaluate(parseTokens(tokenize(fb), parseOpts), ctx);
      } catch (e) {
        if (e instanceof CalcError && /previous result|that = \?/.test(e.message)) intentError = e;
      }
    }
  }

  if (value) {
    // 4. magnitude guard: decimal.js happily represents 1e309, which no downstream consumer can
    if (value.kind !== 'date' && value.kind !== 'time') {
      if (value.value.isNaN()) return { ok: false, display: '', note: 'not a number', isText: false, label: labelKey, spans: spans() };
      if (!value.value.isFinite() || value.value.abs().gt('1e308')) {
        return { ok: false, display: '', note: 'overflow · number out of range (limit 1e308)', isText: false, label: labelKey, spans: spans() };
      }
      if (roundTo !== undefined) {
        // "rounded to 3 decimal places": round the stored value and show exactly that many places
        const rounded = value.value.toDecimalPlaces(roundTo, Decimal.ROUND_HALF_UP);
        const base: Quantity = { ...value, value: rounded, display: undefined };
        const display = value.kind === 'number' ? formatNumber(rounded, { maxDecimals: roundTo, minDecimals: roundTo }) : formatQuantity(base);
        value = { ...base, display, note: value.note ? `${value.note} · rounded to ${roundTo} dp` : `rounded to ${roundTo} dp` };
      }
    }
    return { ok: true, value, display: formatQuantity(value), note: value.note, isText: false, label: labelKey, defines, spans: spans() };
  }
  const err = intentError ?? firstError;
  if (looksLikeText(clean) && !intentError) {
    return { ok: false, display: '', isText: true, label: labelKey, spans: spans() };
  }
  const hint = err?.hint ? `${err.message} · ${err.hint}` : (err?.message ?? 'error');
  return { ok: false, display: '', note: hint, isText: false, label: labelKey, spans: spans() };
}

/** the currency word/code that ends a conversion phrase ("… in USD", "… to rupees"), if any */
function currencyNamed(text: string): boolean {
  const re = /\b(?:in|to|into|as|me|mein|te)\s+([\p{L}][\p{L} .]{1,20}?)(?=\s*(?:[-+*/?.!,]|$))/giu;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const words = m[1].trim().toLowerCase().split(/\s+/);
    for (let n = Math.min(3, words.length); n >= 1; n--) {
      if (findCurrency(words.slice(0, n).join(' '))) return true;
    }
  }
  return false;
}

/** "rounded to 3 decimal places", "to 2 dp", "2 decimals tak": strip the request and return how many places */
const ROUND_RE = /\b(?:rounded|round(?:ed)?(?:\s+off)?|correct|accurate|upto|up\s+to)?\s*(?:to|till|tak)?\s*(\d{1,2})\s*(?:decimal\s+places?|decimals?|dp|digits?|places?)\b(?:\s+(?:tak|me|mein|e))?/i;
export function extractRounding(text: string): { text: string; places?: number } {
  const m = ROUND_RE.exec(text);
  if (!m || !/\b(round|decimal|dp|digit|place|upto|up to|correct|accurate)/i.test(m[0])) return { text };
  return { text: (text.slice(0, m.index) + ' ' + text.slice(m.index + m[0].length)).replace(/\s+/g, ' ').trim(), places: parseInt(m[1], 10) };
}

/** "clear context", "reset", "sab bhool jao": a line that stops previous-result references and forgets variables */
export function isResetLine(text: string): boolean {
  const { words } = normalize(text);
  return words.length > 0 && words.length <= 3 && words.includes('reset');
}

/** words that can never be an implicit variable name */
function isPlainName(word: string, variables: Set<string>): boolean {
  if (!/^[\p{L}][\p{L}\p{N}_]*$/u.test(word)) return false;
  if (variables.has(word)) return true;
  if (KEYWORDS.has(word) || CANON_KEYWORDS.has(word) || SOURCE_WORDS.has(word)) return false;
  if (isUnitWord(word) || isCurrencyWord(word) || isZoneWord(word)) return false;
  if (own(SCALES, word) || word === 'percent' || word === 'ago') return false;
  return true;
}

/**
 * "rahul Rs 100" → rahul = ₹100. One to three leading name words followed by something that starts
 * with a number or currency and evaluates on its own. The name only exists while its line is visible.
 */
function tryImplicitDefinition(
  clean: string,
  parseOpts: { variables: Set<string>; now: DateTime; zone: string },
  ctx: EvalContext,
  variables: Set<string>,
): { name: string; value: Quantity; start: number; end: number } | null {
  const toks = tokenize(clean).filter((t) => t.type !== 'space');
  let n = 0;
  while (n < 3 && toks[n]?.type === 'word' && isPlainName(toks[n].value, variables)) n++;
  if (n === 0 || n >= toks.length) return null;
  const first = toks[n];
  const startsValue = first.type === 'number' || first.type === 'currency' || (first.type === 'word' && isCurrencyWord(first.value) && toks[n + 1]?.type === 'number');
  if (!startsValue) return null;
  const rest = clean.slice(first.start);
  try {
    const value = evaluate(parseTokens(tokenize(rest), parseOpts), ctx);
    if (value.kind === 'date' || value.kind === 'time') return null;
    const name = toks
      .slice(0, n)
      .map((t) => t.value)
      .join(' ');
    return { name, value, start: toks[0].start, end: toks[n - 1].end };
  } catch {
    return null;
  }
}

export function evaluateDocument(lines: string[], opts: DocumentOptions): LineResult[] {
  const zone = opts.zone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC';
  const now = opts.now ?? (() => DateTime.now().setZone(zone));
  const variables = new Map<string, Quantity>();
  const previous: (Quantity | null)[] = [];
  let block: Quantity[] = [];
  let contextStart = 0;
  const results: LineResult[] = [];
  for (const line of lines) {
    if (line.trim() === '') {
      block = [];
      previous.push(null);
      results.push({ ok: false, display: '', isText: true, spans: [] });
      continue;
    }
    const ctx: EvalContext = { variables, previous, block, rates: opts.rates, now, zone, contextStart };
    const r = evaluateLine(line, ctx, new Set(variables.keys()));
    results.push(r);
    previous.push(r.ok ? r.value! : null);
    if (r.resetsContext) {
      // explicit reset: forget variables and everything above for "that"/"previous result"
      contextStart = previous.length;
      variables.clear();
      block = [];
      continue;
    }
    if (r.ok) {
      block.push(r.value!);
      if (r.label) variables.set(r.label, r.value!);
      if (r.defines) for (const [k, v] of Object.entries(r.defines)) variables.set(k, v);
    }
  }
  return results;
}
