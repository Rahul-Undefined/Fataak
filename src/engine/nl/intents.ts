/**
 * Intent layer over normalised words.
 *
 * Structure:
 *  - `analyse` tags every word (number, percent, verb, connector, name).
 *  - `intentChain` is the structured operation model: the sentence is split into clauses
 *    (",", "then", "and"); each clause yields a starting value, a named value, an operation
 *    (+/−/×/÷/percent up/down/percent of) or a request for the total, and the operations are
 *    applied in order. This covers sequential raises/discounts, "half of X and add Y",
 *    "A 150, B 250, total?", and references to the running value ("that", "new amount").
 *  - Specialised intents (EMI, interest, revenue/expenses, margin/markup, GST, discount,
 *    profit/loss, dates, percent questions, increase/decrease, conversion) handle one-shot
 *    questions and share the same tagging helpers.
 *
 * Every intent returns a Quantity, throws CalcError with a hint (matched but ambiguous or
 * incomplete — the UI shows the hint instead of a guess), or returns null (does not apply).
 */
import { DateTime } from 'luxon';
import { Decimal, CalcError, type EvalContext, type Quantity } from '../types';
import { normalize } from './normalize';
import { parse } from '../parser';
import { evaluate, convertMoney } from '../evaluator';
import * as fin from '../finance';
import { formatQuantity, formatNumber } from '../format';
import { findZones, convertTime, tzResultQuantity, nowInZone, type ZoneRef } from '../timezone';
import { tokenize } from '../tokenizer';
import { tryParseDate } from '../dates';
import { isCurrencyWord, currencyBySymbol, findCurrency } from '../currency';
import { isUnitWord, findUnit } from '../units';
import { KEYWORDS } from '../parser';
import { CANON_KEYWORDS, SOURCE_WORDS } from './normalize';

const PCT_RE = /^(\d+(?:\.\d+)?)%$/;
const NUM_RE = /^[₹$€£¥৳]?\d[\d,]*(?:\.\d+)?$/;
const TIME_UNITS = new Set(['years', 'months', 'weeks', 'days', 'hours', 'minutes']);
const CONNECTORS = new Set(['of', 'on', 'in', 'to', 'from', 'for', 'at', 'by', 'and', 'with', 'what', 'after', 'before', 'between', 'is', 'than', 'then', 'now', 'time', ',', 'another', 'that', 'start']);
const VERBS = new Set([
  'increase', 'decrease', 'add', 'remove', 'inclusive', 'without', 'gst', 'discount', 'profit', 'loss', 'cost', 'sell', 'margin', 'markup', 'emi', 'loan', 'interest', 'simple', 'compound', 'convert', 'change',
  'revenue', 'expenses', 'double', 'triple', 'times', 'divide', 'minus', 'plus', 'total', 'sum', 'base',
]);
const SCALE_WORDS = new Set(['k', 'thousand', 'hazaar', 'hazar', 'hajar', 'lakh', 'lakhs', 'lac', 'lacs', 'crore', 'crores', 'cr', 'koti', 'lokkho', 'million', 'mn', 'billion', 'bn', 'hundred']);
const SEQUENCE_SPLIT = new Set([',', 'then', 'and']);

export interface Parsed {
  words: string[];
  pcts: number[]; // indices of percent tokens
  nums: number[]; // indices of number tokens (incl. ₹500)
  has: (w: string) => boolean;
  idx: (w: string) => number;
  lastIdx: (w: string) => number;
  notes: string[];
  /** "starting at 50000" style clause (never a name definition) */
  isStartLike?: boolean;
}

function analyse(words: string[], notes: string[]): Parsed {
  const pcts: number[] = [];
  const nums: number[] = [];
  words.forEach((w, i) => {
    if (PCT_RE.test(w)) pcts.push(i);
    else if (NUM_RE.test(w)) nums.push(i);
  });
  return { words, pcts, nums, has: (w) => words.includes(w), idx: (w) => words.indexOf(w), lastIdx: (w) => words.lastIndexOf(w), notes };
}

function pctAt(p: Parsed, i: number): Decimal {
  return new Decimal(p.words[i].slice(0, -1));
}

/** Evaluate a sub-expression made of the given words through the normal parser. */
function evalWords(words: string[], ctx: EvalContext): Quantity {
  const text = words.join(' ');
  if (!text.trim()) throw new CalcError('amount?', 'add the amount');
  const node = parse(text, { variables: new Set(ctx.variables.keys()), now: ctx.now(), zone: ctx.zone });
  return evaluate(node, ctx);
}

/** A number token (possibly with currency symbol / following scale word / currency word / unit) → Quantity. */
function numberAt(p: Parsed, i: number, ctx: EvalContext): { q: Quantity; used: Set<number> } {
  const used = new Set<number>([i]);
  const parts = [p.words[i]];
  let j = i + 1;
  while (j < p.words.length && (SCALE_WORDS.has(p.words[j]) || isCurrencyWord(p.words[j]) || (isUnitWord(p.words[j]) && !TIME_UNITS.has(p.words[j])))) {
    parts.push(p.words[j]);
    used.add(j);
    j++;
  }
  // currency word before the number: "inr 5000"
  if (i > 0 && isCurrencyWord(p.words[i - 1]) && !TIME_UNITS.has(p.words[i - 1])) {
    parts.unshift(p.words[i - 1]);
    used.add(i - 1);
  }
  return { q: evalWords(parts, ctx), used };
}

const OPERATOR_WORDS = new Set(['+', '-', '*', '/', '^', '(', ')', 'x', 'times', 'plus', 'minus', 'mod', 'prev', 'ans', 'of', 'off', 'on']);

/** words that can take part in a base expression: numbers, variables, units, currencies, scales, operators */
function expressionWords(p: Parsed, used: Set<number>, ctx: EvalContext, keepPercents = false): string[] {
  const rest = p.words.filter(
    (w, i) => !used.has(i) && !VERBS.has(w) && (!CONNECTORS.has(w) || w === 'of' || w === 'on') && (keepPercents || (!PCT_RE.test(w) && w !== '%')) && !TIME_UNITS.has(w),
  );
  const keep = rest.filter(
    (w) => NUM_RE.test(w) || PCT_RE.test(w) || /^[(),.]*[\d₹$€£¥৳]/.test(w) || OPERATOR_WORDS.has(w) || ctx.variables.has(w) || SCALE_WORDS.has(w) || isUnitWord(w) || isCurrencyWord(w) || !!currencyBySymbol(w),
  );
  // multi-word variables ("basic salary") are matched as a phrase
  for (let n = 4; n >= 2; n--) {
    for (let i = 0; i + n <= rest.length; i++) {
      const phrase = rest.slice(i, i + n).join(' ');
      if (ctx.variables.has(phrase) && !keep.includes(phrase)) keep.push(phrase);
    }
  }
  const dangling = ['+', '-', '*', '/', '^', 'x', 'times', 'plus', 'minus', 'of', 'off', 'on'];
  while (keep.length && dangling.includes(keep[keep.length - 1])) keep.pop();
  while (keep.length && dangling.filter((d) => d !== '-').includes(keep[0])) keep.shift();
  return keep;
}

function remainingBase(p: Parsed, used: Set<number>, ctx: EvalContext): Quantity {
  const keep = expressionWords(p, used, ctx);
  if (keep.length === 0) {
    // nothing usable: if the user named something (an undefined variable), say so — never guess a value
    const named = p.words.filter((w, i) => !used.has(i) && !VERBS.has(w) && !CONNECTORS.has(w) && !PCT_RE.test(w) && /^[\p{L}][\p{L}\p{N}_]*$/u.test(w));
    if (named.length) throw new CalcError(`${named[0]} = ?`, `define it above: ${named[0]}: 100`);
    throw new CalcError('amount?', 'e.g. 25000 or a variable like salary');
  }
  return evalWords(keep, ctx);
}

function moneyOrNumber(v: Decimal, like: Quantity): Quantity {
  return like.kind === 'money' ? { kind: 'money', value: v, currency: like.currency } : like.kind === 'unit' ? { kind: 'unit', value: v, unit: like.unit } : { kind: 'number', value: v };
}

function tenureMonths(p: Parsed, used: Set<number>): number | null {
  for (let i = 0; i < p.words.length; i++) {
    if (!TIME_UNITS.has(p.words[i])) continue;
    const k = i - 1;
    if (k >= 0 && NUM_RE.test(p.words[k]) && !PCT_RE.test(p.words[k])) {
      const n = new Decimal(p.words[k].replace(/[^\d.]/g, ''));
      used.add(k);
      used.add(i);
      const unit = p.words[i];
      const months = unit === 'years' ? n.mul(12) : unit === 'months' ? n : unit === 'weeks' ? n.mul(12).div(52) : unit === 'days' ? n.mul(12).div(365) : null;
      if (months === null) return null;
      return months.toNumber();
    }
  }
  return null;
}

/** words that can be a person's/thing's name in "rahul 150" */
function isNameWord(w: string, ctx: EvalContext): boolean {
  if (!/^[\p{L}][\p{L}\p{N}_]*$/u.test(w)) return false;
  if (ctx.variables.has(w)) return true;
  if (VERBS.has(w) || CONNECTORS.has(w) || KEYWORDS.has(w) || CANON_KEYWORDS.has(w) || SOURCE_WORDS.has(w)) return false;
  if (isUnitWord(w) || isCurrencyWord(w) || SCALE_WORDS.has(w) || TIME_UNITS.has(w)) return false;
  return true;
}

// ---------------------------------------------------------------- structured operation chain

type OpKind = 'add' | 'sub' | 'mul' | 'div' | 'pctInc' | 'pctDec' | 'pctOf';
interface Op {
  kind: OpKind;
  amount: Quantity;
  label: string;
}
interface Clause {
  words: string[];
  p: Parsed;
  /** a value this clause establishes (start value or a named amount) */
  value?: Quantity;
  name?: string;
  isStart: boolean;
  wantsTotal: boolean;
  op?: Op;
}

function splitClauses(words: string[]): string[][] {
  const raw: string[][] = [];
  let cur: string[] = [];
  for (const w of words) {
    if (SEQUENCE_SPLIT.has(w)) {
      if (cur.length) raw.push(cur);
      cur = [];
    } else cur.push(w);
  }
  if (cur.length) raw.push(cur);
  // a fragment without any number belongs to the clause before it ("5% aur badhao" → "5% increase")
  const out: string[][] = [];
  for (const c of raw) {
    const hasNumber = c.some((w) => NUM_RE.test(w) || PCT_RE.test(w));
    if (!hasNumber && out.length) out[out.length - 1].push(...c);
    else out.push(c);
  }
  return out;
}

function analyseClause(words: string[], ctx: EvalContext): Clause {
  const p = analyse(words, []);
  p.isStartLike = p.has('start');
  const c: Clause = { words, p, isStart: p.has('start'), wantsTotal: p.has('total') || p.has('sum') };
  // strong verbs first; a bare "on" only counts as "add" when nothing else says otherwise ("10% off on 1000" is a discount)
  const strongInc = Math.max(p.lastIdx('increase'), p.lastIdx('add'), p.lastIdx('plus'), p.lastIdx('+'), p.lastIdx('with'));
  const dec = Math.max(p.lastIdx('decrease'), p.lastIdx('remove'), p.lastIdx('minus'), p.lastIdx('-'), p.lastIdx('discount'), p.lastIdx('off'), p.lastIdx('without'), p.lastIdx('less'));
  const inc = strongInc >= 0 ? strongInc : dec < 0 && p.has('on') ? p.lastIdx('on') : -1;
  const mul = Math.max(p.lastIdx('times'), p.lastIdx('*'), p.lastIdx('x'));
  const div = Math.max(p.lastIdx('divide'), p.lastIdx('/'));
  const factor = p.has('double') ? 2 : p.has('triple') ? 3 : 0;

  if (p.pcts.length >= 1) {
    const pct = pctAt(p, p.pcts[0]);
    const amount: Quantity = { kind: 'percent', value: pct };
    const refersBack = p.has('that') || p.has('prev');
    const kind: OpKind = inc > dec && inc >= 0 ? 'pctInc' : dec >= 0 ? 'pctDec' : p.has('of') || refersBack ? 'pctOf' : 'pctInc';
    c.op = { kind, amount, label: `${kind === 'pctInc' ? '+' : kind === 'pctDec' ? '−' : ''}${formatNumber(pct)}%${kind === 'pctOf' ? ' of' : ''}` };
    // "10% of 500" / "18% discount on 1000": the number in the same clause is the base (start value)
    if (p.nums.length >= 1) {
      const { q } = numberAt(p, p.nums[0], ctx);
      if (kind === 'pctOf') {
        c.value = moneyOrNumber(q.value.mul(pct).div(100), q);
        c.op = undefined;
      } else c.value = q;
    }
    return c;
  }
  if (factor && p.nums.length === 0) {
    c.op = { kind: 'mul', amount: { kind: 'number', value: new Decimal(factor) }, label: `×${factor}` };
    return c;
  }
  if (p.nums.length >= 1) {
    const { q, used } = numberAt(p, p.nums[0], ctx);
    if (factor) {
      // "1000 ka double" → a value of 2000
      c.value = moneyOrNumber(q.value.mul(factor), q);
      return c;
    }
    const verb = Math.max(inc, dec, mul, div);
    if (verb >= 0 && !c.isStart) {
      const kind: OpKind = verb === mul ? 'mul' : verb === div ? 'div' : verb === dec ? 'sub' : 'add';
      c.op = { kind, amount: q, label: `${kind === 'add' ? '+' : kind === 'sub' ? '−' : kind === 'mul' ? '×' : '÷'} ${formatQuantity(q)}` };
      return c;
    }
    // a value clause: "rahul 150", "rohit of 500" (Bengali "er"), "5000 of 0.5", "starting at 50000", "₹1,200"
    const leading: string[] = [];
    for (const w of words) {
      if (isNameWord(w, ctx)) leading.push(w);
      else break;
    }
    let after = leading.length;
    if (words[after] === 'of') after++;
    const namedAmount = leading.length > 0 && leading.length <= 3 && p.nums.includes(after) && !p.isStartLike;
    if (namedAmount) {
      // "name [of] amount": defines/redefines the name, even if it already exists as a variable
      c.name = leading.join(' ');
      c.value = numberAt(p, after, ctx).q;
      return c;
    }
    const exprWords = expressionWords(p, new Set(), ctx);
    try {
      c.value = exprWords.length ? evalWords(exprWords, ctx) : q;
    } catch {
      c.value = q;
      void used;
    }
    return c;
  }
  return c;
}

function applyOp(v: Quantity, op: Op, ctx: EvalContext): Quantity {
  const a = op.amount;
  switch (op.kind) {
    case 'add':
    case 'sub': {
      let amt = a;
      if (v.kind === 'money' && a.kind === 'money' && a.currency !== v.currency) amt = convertMoney(a, v.currency!, ctx);
      return moneyOrNumber(op.kind === 'add' ? v.value.plus(amt.value) : v.value.minus(amt.value), v.kind === 'number' ? a : v);
    }
    case 'mul':
      return moneyOrNumber(v.value.mul(a.value), v);
    case 'div':
      if (a.value.isZero()) throw new CalcError('division by zero');
      return moneyOrNumber(v.value.div(a.value), v);
    case 'pctInc':
      return moneyOrNumber(v.value.mul(new Decimal(100).plus(a.value)).div(100), v);
    case 'pctDec':
      return moneyOrNumber(v.value.mul(new Decimal(100).minus(a.value)).div(100), v);
    case 'pctOf':
      return moneyOrNumber(v.value.mul(a.value).div(100), v);
  }
}

export interface IntentResult extends Quantity {
  /** names defined by this line ("Rahul ko 150, Rohit ko 250") */
  defines?: Record<string, Quantity>;
}

/**
 * Multi-step sentences: "5000 ka aadha aur usmein 250 jodo", "10% raise, then another 5% raise, starting at 50000",
 * "Rahul ko 150, Rohit ko 250, total kitna", "20% off then 10% off on 1000".
 */
function intentChain(p: Parsed, ctx: EvalContext): IntentResult | null {
  const markers = p.has('then') || p.has('that') || p.has('start') || p.has('another');
  if (!markers && !p.has(',')) return null;
  // specialised vocabulary (GST, EMI, revenue…) is handled by its own intent
  if (['gst', 'emi', 'interest', 'revenue', 'expenses', 'margin', 'markup', 'cost', 'sell', 'loan'].some((w) => p.has(w))) return null;
  const clauses = splitClauses(p.words).map((w) => analyseClause(w, ctx));
  if (!markers) {
    // comma-only sentences are a chain only when at least two clauses carry numbers
    const numeric = clauses.filter((c) => c.p.nums.length || c.p.pcts.length);
    if (numeric.length < 2) return null;
  }
  const ops = clauses.filter((c) => c.op);
  const values = clauses.filter((c) => c.value);
  const wantsTotal = clauses.some((c) => c.wantsTotal);
  const named = values.filter((c) => c.name);

  // named amounts with a total: "rahul 150, rohit 250, total?"
  if (wantsTotal && values.length >= 2 && ops.length === 0) {
    let acc: Quantity = values[0].value!;
    for (const c of values.slice(1)) acc = applyOp(acc, { kind: 'add', amount: c.value!, label: '' }, ctx);
    const defines: Record<string, Quantity> = {};
    for (const c of named) defines[c.name!] = c.value!;
    return { ...acc, note: values.map((c) => `${c.name ? c.name + ' ' : ''}${formatQuantity(c.value!)}`).join(' + '), defines: Object.keys(defines).length ? defines : undefined };
  }
  if (ops.length === 0) return null;
  // starting value: an explicit "starting at", else the first clause that carries a value
  const startClause = clauses.find((c) => c.isStart && c.value) ?? values[0];
  if (!startClause) {
    if (p.has('that') || p.has('prev')) {
      const prev = ctx.previous[ctx.previous.length - 1];
      if (!prev) throw new CalcError('that = ?', 'the line above has no result to work from');
      let acc: Quantity = prev;
      const trail = [formatQuantity(prev)];
      for (const c of ops) {
        acc = applyOp(acc, c.op!, ctx);
        trail.push(formatQuantity(acc));
      }
      return { ...acc, note: trail.join(' → ') };
    }
    throw new CalcError('starting amount?', 'e.g. … starting at 50000');
  }
  let acc: Quantity = startClause.value!;
  const trail = [formatQuantity(acc)];
  for (const c of clauses) {
    if (!c.op) continue;
    acc = applyOp(acc, c.op, ctx);
    trail.push(formatQuantity(acc));
  }
  const start = startClause.value!;
  const delta = acc.value.minus(start.value);
  let note = trail.join(' → ');
  if (!delta.isZero() && !start.value.isZero() && acc.kind === start.kind) {
    const pct = fin.pct2(delta.div(start.value).mul(100));
    note += ` · ${delta.isNegative() ? '−' : '+'}${formatQuantity(moneyOrNumber(delta.abs(), start))} (${formatNumber(pct.abs())}%)`;
  }
  return { ...acc, note };
}

// ---------------------------------------------------------------- one-shot intents

function intentTimezone(raw: string, ctx: EvalContext): Quantity | null {
  const lower = raw.toLowerCase().replace(/[?,]/g, ' ');
  const { words } = normalize(lower);
  // locate a time literal in the raw tokens
  const toks = tokenize(lower).filter((t) => t.type !== 'space');
  let time: { hour: number; minute: number; start: number; end: number } | null = null;
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (t.type === 'word' && (t.value === 'noon' || t.value === 'midnight')) {
      time = { hour: t.value === 'noon' ? 12 : 0, minute: 0, start: t.start, end: t.end };
      break;
    }
    if (t.type !== 'number') continue;
    const r = tryParseDate(toks, i, ctx.now(), ctx.zone);
    if (r && r.q.kind === 'time') {
      time = { hour: r.q.date!.hour, minute: r.q.date!.minute, start: t.start, end: toks[i + r.consumed - 1].end };
      break;
    }
  }
  const wordList = words.filter((w) => !PCT_RE.test(w));
  const zones = findZones(wordList);
  // relative offset from now: "2 hours from now", "in 3 hours", "30 min ago", "2 ghante baad"
  let offsetSeconds = 0;
  let hasOffset = false;
  for (let i = 0; i + 1 < wordList.length; i++) {
    if (!NUM_RE.test(wordList[i]) || PCT_RE.test(wordList[i])) continue;
    const u = findUnit(wordList[i + 1]);
    if (!u || u.dim !== 'time') continue;
    offsetSeconds += parseFloat(wordList[i].replace(/[^\d.]/g, '')) * u.factor.toNumber();
    hasOffset = true;
  }
  if (hasOffset && (wordList.includes('ago') || wordList.includes('before'))) offsetSeconds = -offsetSeconds;
  const wantsNow = !time && (wordList.includes('time') || wordList.includes('now') || hasOffset);
  if (zones.length === 0) return null;
  if (!time && !wantsNow) return null;
  if (!time) {
    const base = ctx.now().plus({ seconds: offsetSeconds });
    const q = nowInZone(zones[zones.length - 1].ref, base);
    if (hasOffset) {
      const h = Math.abs(offsetSeconds) / 3600;
      const span = h >= 1 ? `${formatNumber(new Decimal(h))} h` : `${Math.round(Math.abs(offsetSeconds) / 60)} min`;
      q.note = `now ${offsetSeconds < 0 ? '−' : '+'} ${span}${q.note ? ` · ${q.note}` : ''}`;
    }
    return q;
  }
  // optional explicit date in the text (tomorrow, 25 dec)
  let date: DateTime | undefined;
  const dateToks = tokenize(wordList.join(' ')).filter((t) => t.type !== 'space');
  for (let i = 0; i < dateToks.length; i++) {
    const r = tryParseDate(dateToks, i, ctx.now(), ctx.zone);
    if (r && r.q.kind === 'date') {
      date = r.q.date;
      break;
    }
  }
  let fromRef: ZoneRef;
  let toRef: ZoneRef;
  if (zones.length >= 2) {
    fromRef = zones[0].ref;
    toRef = zones[1].ref;
  } else {
    const z = zones[0];
    const before = wordList.slice(0, z.start);
    const hasTo = before.some((w) => w === 'to' || w === 'in');
    const local: ZoneRef = { zone: ctx.zone, label: 'local' };
    if (hasTo) {
      fromRef = local;
      toRef = z.ref;
    } else {
      fromRef = z.ref;
      toRef = local;
      if (fromRef.zone === toRef.zone) return null;
    }
  }
  const conv = convertTime({ hour: time.hour, minute: time.minute, date, fromRef, toRef, now: ctx.now() });
  return tzResultQuantity(conv);
}

function intentDates(p: Parsed, ctx: EvalContext): Quantity | null {
  const w = p.words.filter((x) => x !== ',');
  const text = w.join(' ');
  const toks = tokenize(text).filter((t) => t.type !== 'space');
  const dates: { q: Quantity; start: number; end: number }[] = [];
  for (let i = 0; i < toks.length; ) {
    const r = tryParseDate(toks, i, ctx.now(), ctx.zone);
    if (r && r.q.kind === 'date') {
      dates.push({ q: r.q, start: i, end: i + r.consumed });
      i += r.consumed;
    } else i++;
  }
  if (dates.length === 0) return null;
  if (dates.length >= 2) {
    const a = dates[0].q.date!;
    const b = dates[1].q.date!;
    const days = b.startOf('day').diff(a.startOf('day'), 'days').days;
    return { kind: 'unit', value: new Decimal(days), unit: 'day', note: `${a.toFormat('d LLL yyyy')} → ${b.toFormat('d LLL yyyy')}` };
  }
  let amount: Decimal | null = null;
  let unit: string | null = null;
  for (let i = 0; i < w.length; i++) {
    if (TIME_UNITS.has(w[i]) && i > 0 && NUM_RE.test(w[i - 1])) {
      amount = new Decimal(w[i - 1].replace(/[^\d.]/g, ''));
      unit = w[i];
      break;
    }
  }
  if (amount === null || !unit) {
    const d = dates[0].q.date!;
    if (dates[0].q.display) return dates[0].q;
    // Hindi/Bengali order: "february 2028 ka last day", "march er sesh din"
    if ((p.has('last') || p.has('end')) && (p.has('day') || p.has('days'))) {
      const res = d.endOf('month').startOf('day');
      return { kind: 'date', value: new Decimal(res.toMillis()), date: res, display: res.toFormat('ccc, d LLL yyyy') };
    }
    if ((p.has('first') || p.has('start')) && (p.has('day') || p.has('days'))) {
      const res = d.startOf('month');
      return { kind: 'date', value: new Decimal(res.toMillis()), date: res, display: res.toFormat('ccc, d LLL yyyy') };
    }
    if (p.has('what') || p.has('days') || p.has('day')) return { ...dates[0].q, display: d.toFormat('ccc, d LLL yyyy') };
    return null;
  }
  const sign = p.has('before') ? -1 : 1;
  const d = dates[0].q.date!;
  const unitKey = unit as 'years' | 'months' | 'weeks' | 'days' | 'hours' | 'minutes';
  const shifted = d.plus({ [unitKey]: amount.mul(sign).toNumber() });
  const q: Quantity = { kind: 'date', value: new Decimal(shifted.toMillis()), date: shifted, display: shifted.toFormat('ccc, d LLL yyyy') };
  if (p.notes.length) q.note = p.notes.join(' · ');
  return q;
}

function intentEmi(p: Parsed, ctx: EvalContext): Quantity | null {
  if (!p.has('emi') && !(p.has('loan') && p.pcts.length > 0)) return null;
  const used = new Set<number>();
  const months = tenureMonths(p, used);
  if (p.pcts.length === 0) throw new CalcError('rate?', 'e.g. emi 5 lakh at 9% for 5 years');
  if (months === null) throw new CalcError('tenure?', 'add years or months: … for 5 years');
  const rate = pctAt(p, p.pcts[0]);
  used.add(p.pcts[0]);
  const principalIdx = p.nums.find((i) => !used.has(i));
  if (principalIdx === undefined) throw new CalcError('loan amount?', 'e.g. emi 5 lakh at 9% for 5 years');
  const { q: principal } = numberAt(p, principalIdx, ctx);
  const r = fin.emi(principal.value, rate, Math.round(months));
  const emiQ = moneyOrNumber(r.emi, principal);
  return {
    ...emiQ,
    display: `${formatQuantity(emiQ)}/month`,
    note: `${Math.round(months)} months · total ${formatQuantity(moneyOrNumber(r.totalPayment, principal))} · interest ${formatQuantity(moneyOrNumber(r.totalInterest, principal))}`,
  };
}

function intentInterest(p: Parsed, ctx: EvalContext): Quantity | null {
  if (!p.has('interest') && !p.has('compound') && !p.has('simple')) return null;
  const used = new Set<number>();
  const months = tenureMonths(p, used);
  if (p.pcts.length === 0) throw new CalcError('rate?', 'e.g. interest on 10000 at 5% for 2 years');
  if (months === null) throw new CalcError('period?', 'add years or months: … for 2 years');
  const rate = pctAt(p, p.pcts[0]);
  used.add(p.pcts[0]);
  const principalIdx = p.nums.find((i) => !used.has(i));
  if (principalIdx === undefined) throw new CalcError('principal?', 'e.g. interest on 10000 at 5% for 2 years');
  const { q: principal } = numberAt(p, principalIdx, ctx);
  const years = new Decimal(months).div(12);
  if (p.has('compound')) {
    const freq: fin.Compounding = p.has('monthly') ? 'monthly' : p.has('quarterly') ? 'quarterly' : p.has('half-yearly') ? 'half-yearly' : p.has('daily') ? 'daily' : 'yearly';
    const r = fin.compoundInterest(principal.value, rate, years, freq);
    const q = moneyOrNumber(r.interest, principal);
    return { ...q, note: `compound ${freq} · total ${formatQuantity(moneyOrNumber(r.total, principal))}` };
  }
  const r = fin.simpleInterest(principal.value, rate, years);
  const q = moneyOrNumber(r.interest, principal);
  return { ...q, note: `simple interest · total ${formatQuantity(moneyOrNumber(r.total, principal))}` };
}

/** pick the number nearest to a marker word, reading direction from the language pattern */
function numberNear(p: Parsed, marker: number, used: Set<number>): number | undefined {
  const LINK = new Set(['at', 'in', 'on', 'of', 'for', 'to', 'from', 'with', 'is', '=']);
  const after = p.words[marker + 1];
  const before = p.words[marker - 1];
  const forwardFirst = before !== undefined && LINK.has(before) ? false : (after !== undefined && (LINK.has(after) || p.nums.includes(marker + 1))) || before === undefined || !p.nums.includes(marker - 1);
  const scan = (dir: 1 | -1): number | undefined => {
    for (let i = marker + dir; i >= 0 && i < p.words.length; i += dir) {
      if (p.nums.includes(i) && !used.has(i)) return i;
      if (p.words[i] === ',' || (VERBS.has(p.words[i]) && !['cost', 'sell', 'revenue', 'expenses'].includes(p.words[i]))) break;
    }
    return undefined;
  };
  return forwardFirst ? (scan(1) ?? scan(-1)) : (scan(-1) ?? scan(1));
}

/** revenue − expenses → profit and margin ("Revenue 500000, expenses 350000, profit margin?") */
function intentBusiness(p: Parsed, ctx: EvalContext): Quantity | null {
  // "sales/bikri" normalise to the selling-price marker; with "expenses" they mean revenue
  const revMarker = p.has('revenue') ? p.idx('revenue') : p.has('sell') && p.has('expenses') ? p.idx('sell') : -1;
  if (revMarker < 0) return null;
  const expMarker = p.has('expenses') ? p.idx('expenses') : p.has('cost') ? p.idx('cost') : -1;
  if (expMarker < 0) return null;
  const used = new Set<number>();
  const revIdx = numberNear(p, revMarker, used);
  if (revIdx === undefined) throw new CalcError('revenue amount?', 'e.g. revenue 500000, expenses 350000');
  used.add(revIdx);
  const expIdx = numberNear(p, expMarker, used);
  if (expIdx === undefined) throw new CalcError('expenses amount?', 'e.g. revenue 500000, expenses 350000');
  const { q: revenue } = numberAt(p, revIdx, ctx);
  const { q: expenses } = numberAt(p, expIdx, ctx);
  const profit = fin.money2(revenue.value.minus(expenses.value));
  const margin = revenue.value.isZero() ? new Decimal(NaN) : fin.pct2(profit.div(revenue.value).mul(100));
  const breakdown = `revenue ${formatQuantity(revenue)} · expenses ${formatQuantity(expenses)} · profit ${formatQuantity(moneyOrNumber(profit, revenue))}`;
  const wantsMargin = p.has('margin') || p.has('%') || p.has('markup');
  if (wantsMargin) return { kind: 'percent', value: margin, note: `${p.has('markup') ? 'markup' : 'margin'} · ${breakdown}` };
  const q = moneyOrNumber(profit.abs(), revenue);
  return { ...q, display: `${formatQuantity(q)} ${profit.isNegative() ? 'loss' : 'profit'}`, note: `margin ${formatNumber(margin)}% · ${breakdown}` };
}

function intentProfitLoss(p: Parsed, ctx: EvalContext): Quantity | null {
  const hasCost = p.has('cost');
  const hasSell = p.has('sell');
  const hasPL = p.has('profit') || p.has('loss');
  if (!hasCost && !hasSell && !hasPL) return null;
  if (p.has('margin') || p.has('markup')) return null;
  const used = new Set<number>();
  if (hasPL && p.pcts.length === 1 && p.nums.length === 1 && !(hasCost && hasSell)) {
    const pct = pctAt(p, p.pcts[0]);
    const { q: base } = numberAt(p, p.nums[0], ctx);
    const sign = p.has('loss') ? -1 : 1;
    const price = fin.money2(base.value.mul(new Decimal(100).plus(pct.mul(sign))).div(100));
    const q = moneyOrNumber(price, base);
    return { ...q, note: `${p.has('loss') ? 'loss' : 'profit'} ${formatQuantity(moneyOrNumber(price.minus(base.value).abs(), base))} on cost ${formatQuantity(base)}` };
  }
  if (p.nums.length < 2) {
    if (hasPL && p.nums.length === 1) throw new CalcError('selling price?', 'e.g. bought at 500 sold at 600');
    return null;
  }
  let costIdx: number | undefined;
  let sellIdx: number | undefined;
  if (hasCost) {
    costIdx = numberNear(p, p.idx('cost'), used);
    if (costIdx !== undefined) used.add(costIdx);
  }
  if (hasSell) {
    sellIdx = numberNear(p, p.idx('sell'), used);
    if (sellIdx !== undefined) used.add(sellIdx);
  }
  const free = p.nums.filter((i) => !used.has(i));
  if (costIdx === undefined) costIdx = free.shift();
  if (sellIdx === undefined) sellIdx = free.shift();
  if (costIdx === undefined || sellIdx === undefined) throw new CalcError('cost and selling price?', 'e.g. cost 500 sold 600');
  const { q: cost } = numberAt(p, costIdx, ctx);
  const { q: sell } = numberAt(p, sellIdx, ctx);
  const r = fin.profitLoss(cost.value, sell.value);
  const q = moneyOrNumber(r.amount.abs(), cost);
  const label = r.amount.isNegative() ? 'loss' : 'profit';
  return { ...q, display: `${formatQuantity(q)} ${label}`, note: `${formatNumber(r.pct.abs())}% on cost · cost ${formatQuantity(cost)} → sold ${formatQuantity(sell)}` };
}

function intentMarginMarkup(p: Parsed, ctx: EvalContext): Quantity | null {
  const isMargin = p.has('margin');
  const isMarkup = p.has('markup');
  if (!isMargin && !isMarkup) return null;
  const kind = isMargin ? 'margin' : 'markup';
  if (p.pcts.length >= 1 && p.nums.length >= 1) {
    const pct = pctAt(p, p.pcts[0]);
    const { q: cost } = numberAt(p, p.nums[0], ctx);
    const price = isMargin ? fin.priceFromMargin(cost.value, pct) : fin.priceFromMarkup(cost.value, pct);
    if (price.isNaN()) throw new CalcError('margin must be below 100%');
    const q = moneyOrNumber(price, cost);
    const other = isMargin ? `markup ${formatNumber(fin.marginToMarkup(pct))}%` : `margin ${formatNumber(fin.markupToMargin(pct))}%`;
    return { ...q, note: `${kind} ${formatNumber(pct)}% on cost ${formatQuantity(cost)} · profit ${formatQuantity(moneyOrNumber(price.minus(cost.value), cost))} · ${other}` };
  }
  if (p.nums.length >= 2) {
    const used = new Set<number>();
    let costIdx = p.has('cost') ? numberNear(p, p.idx('cost'), used) : undefined;
    if (costIdx !== undefined) used.add(costIdx);
    let priceIdx = p.has('sell') ? numberNear(p, p.idx('sell'), used) : undefined;
    if (priceIdx !== undefined) used.add(priceIdx);
    const free = p.nums.filter((i) => !used.has(i));
    if (costIdx === undefined) costIdx = free.shift();
    if (priceIdx === undefined) priceIdx = free.shift();
    const { q: cost } = numberAt(p, costIdx!, ctx);
    const { q: price } = numberAt(p, priceIdx!, ctx);
    const pct = isMargin ? fin.marginPct(cost.value, price.value) : fin.markupPct(cost.value, price.value);
    const other = isMargin ? `markup ${formatNumber(fin.markupPct(cost.value, price.value))}%` : `margin ${formatNumber(fin.marginPct(cost.value, price.value))}%`;
    return { kind: 'percent', value: pct, note: `${kind} · cost ${formatQuantity(cost)} → price ${formatQuantity(price)} · ${other}` };
  }
  throw new CalcError(`${kind}: cost and %?`, `e.g. ${kind} 25% on 400`);
}

function intentGst(p: Parsed, ctx: EvalContext): Quantity | null {
  if (!p.has('gst')) return null;
  if (p.pcts.length === 0) throw new CalcError('GST rate?', 'e.g. 25000 + 18% GST (rates: 5, 12, 18, 28, 40)');
  const rate = pctAt(p, p.pcts[0]);
  const used = new Set<number>([p.pcts[0]]);
  const base = remainingBase(p, used, ctx);
  const gstIdx = p.idx('gst');
  const addMode = p.has('add') || p.has('with') || p.has('on') || p.has('increase') || p.has('+') || p.has('plus');
  // "1000 me 18% GST hai / ache" — the amount already contains GST
  const containsGst = p.nums.length >= 1 && p.nums[0] < gstIdx && p.words.slice(p.nums[0], gstIdx).includes('in') && !addMode;
  const reverse = p.has('remove') || p.has('inclusive') || p.has('without') || p.has('-') || p.has('base') || p.has('minus') || containsGst || (p.has('from') && !addMode);
  if (reverse) {
    const r = fin.gstRemove(base.value, rate);
    return { ...moneyOrNumber(r.base, base), note: `before GST · GST ${formatQuantity(moneyOrNumber(r.tax, base))} · total ${formatQuantity(base)} @ ${formatNumber(rate)}%` };
  }
  const r = fin.gstAdd(base.value, rate);
  if (addMode) return { ...moneyOrNumber(r.total, base), note: `incl. GST ${formatQuantity(moneyOrNumber(r.tax, base))} @ ${formatNumber(rate)}%` };
  return { ...moneyOrNumber(r.tax, base), note: `GST @ ${formatNumber(rate)}% · total ${formatQuantity(moneyOrNumber(r.total, base))}` };
}

function intentDiscount(p: Parsed, ctx: EvalContext): Quantity | null {
  if (!p.has('discount')) return null;
  if (p.pcts.length === 0) {
    if (p.nums.length >= 2) {
      const { q: a } = numberAt(p, p.nums[0], ctx);
      const { q: b } = numberAt(p, p.nums[1], ctx);
      const hi = Decimal.max(a.value, b.value);
      const lo = Decimal.min(a.value, b.value);
      const pct = fin.pct2(hi.minus(lo).div(hi).mul(100));
      return { kind: 'percent', value: pct, note: `discount ${formatQuantity(moneyOrNumber(hi.minus(lo), a))} on ${formatQuantity(moneyOrNumber(hi, a))}` };
    }
    throw new CalcError('discount %?', 'e.g. 20% discount on 1500');
  }
  // several discounts in one sentence ("20% and 10% discount on 1000") apply one after another
  if (p.pcts.length >= 2) {
    const used = new Set<number>(p.pcts);
    const base = remainingBase(p, used, ctx);
    let v = base.value;
    const trail = [formatQuantity(base)];
    for (const i of p.pcts) {
      v = fin.money2(v.mul(new Decimal(100).minus(pctAt(p, i))).div(100));
      trail.push(formatQuantity(moneyOrNumber(v, base)));
    }
    return { ...moneyOrNumber(v, base), note: `${trail.join(' → ')} · total off ${formatNumber(fin.pct2(base.value.minus(v).div(base.value).mul(100)))}%` };
  }
  const rate = pctAt(p, p.pcts[0]);
  const used = new Set<number>([p.pcts[0]]);
  const base = remainingBase(p, used, ctx);
  const r = fin.discount(base.value, rate);
  return { ...moneyOrNumber(r.final, base), note: `saved ${formatQuantity(moneyOrNumber(r.saved, base))} @ ${formatNumber(rate)}%` };
}

function intentIncreaseDecrease(p: Parsed, ctx: EvalContext): Quantity | null {
  const incIdx = Math.max(p.lastIdx('increase'), p.lastIdx('add'), p.lastIdx('plus'));
  const decIdx = Math.max(p.lastIdx('decrease'), p.lastIdx('remove'), p.lastIdx('minus'));
  if (incIdx < 0 && decIdx < 0) return null;
  // when both appear ("18% nikal ke total me add kar") the last verb is the instruction
  const sign = decIdx > incIdx ? -1 : 1;
  if (p.pcts.length >= 1) {
    const rate = pctAt(p, p.pcts[0]);
    const used = new Set<number>([p.pcts[0]]);
    const base = remainingBase(p, used, ctx);
    const result = base.value.mul(new Decimal(100).plus(rate.mul(sign))).div(100);
    const delta = result.minus(base.value);
    const q = moneyOrNumber(result, base);
    return { ...q, note: `${delta.isNegative() ? '−' : '+'}${formatQuantity(moneyOrNumber(delta.abs(), base))} on ${formatQuantity(base)}` };
  }
  if (p.nums.length >= 1) {
    const amtIdx = p.nums[p.nums.length - 1];
    const { q: amt, used } = numberAt(p, amtIdx, ctx);
    const rest = expressionWords(p, used, ctx);
    if (rest.length === 0) return null;
    const base = evalWords(rest, ctx);
    const result = base.value.plus(amt.value.mul(sign));
    return moneyOrNumber(result, base.kind === 'number' ? amt : base);
  }
  return null;
}

/** 20% of what is 30 cm · 30 is what % of 150 · from 50000 to 57500 % increase · 150 to 200 % change */
function intentPercentQuestions(p: Parsed, ctx: EvalContext): Quantity | null {
  const w = p.words;
  const wi = p.idx('what');
  const bare = w.indexOf('%');
  const numberAfterWhat = wi >= 0 && p.nums.some((i) => i > wi);
  const adjacentWhat = numberAfterWhat && p.pcts.length === 1 && (w[p.pcts[0] + 1] === 'what' || (['of', 'on', 'off'].includes(w[p.pcts[0] + 1]) && w[p.pcts[0] + 2] === 'what'));
  if (adjacentWhat && wi >= 0 && p.nums.length === 1) {
    const pct = pctAt(p, p.pcts[0]);
    const { q: x } = numberAt(p, p.nums[0], ctx);
    const mode = w[p.pcts[0] + 1];
    let v: Decimal;
    if (mode === 'on') v = x.value.div(new Decimal(100).plus(pct)).mul(100);
    else if (mode === 'off' || p.has('discount') || p.has('decrease')) v = x.value.div(new Decimal(100).minus(pct)).mul(100);
    else v = x.value.div(pct).mul(100);
    return moneyOrNumber(v, x);
  }
  if ((p.has('change') || p.has('increase') || p.has('decrease')) && p.nums.length === 1 && p.pcts.length === 1 && p.pcts[0] > p.nums[0] && p.has('to')) {
    // "150 to 200 % change": the percent token is really the second number
    const { q: a } = numberAt(p, p.nums[0], ctx);
    const b = pctAt(p, p.pcts[0]);
    if (a.value.isZero()) throw new CalcError('division by zero', 'the starting value is 0');
    const pct = fin.percentChange(a.value, b);
    const word = pct.isNegative() ? 'decrease' : 'increase';
    return { kind: 'percent', value: pct.abs(), display: `${formatNumber(pct.abs())}% ${word}`, note: `${formatQuantity(a)} → ${formatQuantity(moneyOrNumber(b, a))}` };
  }
  const changeWords = p.has('change') || p.has('increase') || p.has('decrease') || p.has('growth') || p.has('difference');
  if (p.nums.length === 2 && (bare >= 0 || (wi >= 0 && (changeWords || p.has('of'))) || (changeWords && p.has('from') && p.has('to')))) {
    const { q: a } = numberAt(p, p.nums[0], ctx);
    const { q: b } = numberAt(p, p.nums[1], ctx);
    const av = a.kind === 'money' && b.kind === 'money' && a.currency !== b.currency ? convertMoney(a, b.currency!, ctx).value : a.value;
    if (changeWords || p.has('from') || p.has('to')) {
      if (av.isZero()) throw new CalcError('division by zero', 'the starting value is 0');
      const pct = fin.percentChange(av, b.value);
      const word = pct.isNegative() ? 'decrease' : 'increase';
      return { kind: 'percent', value: pct.abs(), display: `${formatNumber(pct.abs())}% ${word}`, note: `${formatQuantity(a)} → ${formatQuantity(b)} (${pct.isNegative() ? '−' : '+'}${formatQuantity(moneyOrNumber(b.value.minus(av).abs(), b))})` };
    }
    const ofIdx = p.idx('of');
    let part = av;
    let whole = b.value;
    if (ofIdx >= 0 && ofIdx < p.nums[0]) {
      part = b.value;
      whole = av;
    }
    if (whole.isZero()) throw new CalcError('division by zero');
    return { kind: 'percent', value: fin.pct2(part.div(whole).mul(100)) };
  }
  return null;
}

/** "100 dollar rupee in" / "5 km miles in" → conversion when exactly one amount and a spare unit/currency word */
function intentConvert(p: Parsed, ctx: EvalContext): Quantity | null {
  if (p.nums.length !== 1) return null;
  const { q, used } = numberAt(p, p.nums[0], ctx);
  const targets = p.words.map((w, i) => ({ w, i })).filter(({ w, i }) => !used.has(i) && (isCurrencyWord(w) || isUnitWord(w) || currencyBySymbol(w)));
  if (targets.length !== 1) {
    const rest = p.words.filter((w, i) => !used.has(i) && !VERBS.has(w) && !CONNECTORS.has(w)).join(' ');
    if (!rest || !(isUnitWord(rest) || findCurrency(rest))) return null;
    return evalWords([q.kind === 'money' ? `${q.value.toString()} ${q.currency}` : q.kind === 'unit' ? `${q.value.toString()} ${q.unit}` : q.value.toString(), 'in', rest], ctx);
  }
  const target = targets[0].w;
  const src = q.kind === 'money' ? `${q.value.toString()} ${q.currency}` : q.kind === 'unit' ? `${q.value.toString()} ${q.unit}` : q.value.toString();
  return evalWords([src, 'in', target], ctx);
}

export function runIntents(raw: string, ctx: EvalContext): IntentResult | null {
  const tz = intentTimezone(raw, ctx);
  if (tz) return tz;
  const { words, notes } = normalize(raw);
  if (words.length === 0) return null;
  const p = analyse(words, notes);
  const order: ((p: Parsed, ctx: EvalContext) => IntentResult | Quantity | null)[] = [
    intentEmi, intentInterest, intentBusiness, intentChain, intentMarginMarkup, intentGst, intentDiscount, intentProfitLoss, intentDates, intentPercentQuestions, intentIncreaseDecrease, intentConvert,
  ];
  for (const intent of order) {
    const r = intent(p, ctx);
    if (r) {
      if (notes.length && !r.note?.includes(notes[0])) r.note = r.note ? `${r.note} · ${notes.join(' · ')}` : notes.join(' · ');
      return r;
    }
  }
  return null;
}

/** canonical words → expression text for the last-resort parse ("25000 of 18%", "10% of prev") */
export function expressionFallback(raw: string, ctx: EvalContext): string | null {
  const { words } = normalize(raw);
  const p = analyse(words, []);
  const keep = expressionWords(p, new Set(), ctx, true);
  // an unknown name that would be silently dropped ("rahul * 2" with no rahul) must surface as an error instead
  const droppedNames = words.filter((w) => !keep.includes(w) && isNameWord(w, ctx) && !ctx.variables.has(w) && !CONNECTORS.has(w) && !VERBS.has(w) && w !== 'prev' && w !== 'that');
  if (droppedNames.length) return null;
  // an incomplete expression ("5 +") must stay an error, not be trimmed into "5"
  const ops = (ws: string[]) => ws.filter((w) => ['+', '-', '*', '/', '^', 'x', 'times', 'plus', 'minus'].includes(w)).length;
  if (ops(words) !== ops(keep)) return null;
  // keep conversion words between operands ("100 dollar in rupee")
  const withConv = words.filter((w) => keep.includes(w) || w === 'in' || w === 'to' || w === 'of' || w === 'off' || w === 'on' || w === 'prev' || w === 'that').map((w) => (w === 'that' ? 'prev' : w));
  while (withConv.length && ['of', 'on', 'in', 'to', 'off'].includes(withConv[withConv.length - 1])) withConv.pop();
  while (withConv.length && ['of', 'on', 'in', 'to', 'off'].includes(withConv[0])) withConv.shift();
  if (withConv.length === 0) return null;
  return withConv.join(' ');
}
