/**
 * Intent layer over normalised words.
 *
 * Structure:
 *  - `analyse` tags every word (number, percent, verb, connector, name).
 *  - `intentChain` is the structured operation model: the sentence is split into clauses
 *    (",", ";", "then", "and"); each clause yields a starting value, a named value, one or more
 *    operations (+/−/×/÷/percent up/down/percent of) or a request for the total, and the
 *    operations are applied in order. This covers sequential raises/discounts, "half of X and
 *    add Y", "A 150, B 250, total?", GST-inclusive prices followed by a discount, and
 *    references to the running value ("that", "new amount").
 *  - Specialised intents (EMI, interest, revenue/expenses, division among people, margin/markup,
 *    GST, discount, profit/loss, dates, percent questions, increase/decrease, conversion) handle
 *    one-shot questions and share the same tagging helpers.
 *
 * Every intent returns a Quantity, throws CalcError with a hint (matched but ambiguous or
 * incomplete — the UI shows the hint instead of a guess), or returns null (does not apply).
 */
import { DateTime } from 'luxon';
import { Decimal, CalcError, lastValidResult, type EvalContext, type Quantity } from '../types';
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
const CONNECTORS = new Set(['of', 'on', 'in', 'to', 'from', 'for', 'at', 'by', 'and', 'with', 'what', 'after', 'before', 'between', 'is', 'than', 'then', 'now', 'time', ',', 'another', 'that', 'start', 'each', 'equally', 'people', 'compute']);
const VERBS = new Set([
  'increase', 'decrease', 'add', 'remove', 'inclusive', 'without', 'gst', 'discount', 'profit', 'loss', 'cost', 'sell', 'margin', 'markup', 'emi', 'loan', 'interest', 'simple', 'compound', 'convert', 'change',
  'revenue', 'expenses', 'double', 'triple', 'times', 'divide', 'minus', 'plus', 'total', 'sum', 'base', 'parts', 'reset',
]);
const SCALE_WORDS = new Set(['k', 'thousand', 'hazaar', 'hazar', 'hajar', 'lakh', 'lakhs', 'lac', 'lacs', 'crore', 'crores', 'cr', 'koti', 'lokkho', 'million', 'mn', 'billion', 'bn', 'hundred']);
const SEQUENCE_SPLIT = new Set([',', 'then', 'and', 'that']);
/** words that mean "do something to the amount": a sentence with none of them and "X P%" is a plain percent-of */
const OPERATION_WORDS = new Set(['increase', 'decrease', 'add', 'remove', 'discount', 'off', 'on', 'gst', 'profit', 'loss', 'margin', 'markup', 'emi', 'loan', 'interest', 'change', 'minus', 'plus', 'times', 'divide', 'double', 'triple', 'to', '+', '-', '*', '/', '^']);

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
  for (;;) {
    if (j >= p.words.length) break;
    if (SCALE_WORDS.has(p.words[j]) || isCurrencyWord(p.words[j]) || (isUnitWord(p.words[j]) && !TIME_UNITS.has(p.words[j]))) {
      parts.push(p.words[j]);
      used.add(j);
      j++;
      continue;
    }
    // multi-word units: "cubic metres", "tea spoons", "sq ft"
    let matched = false;
    for (let n = 3; n >= 2; n--) {
      const phrase = p.words.slice(j, j + n).join(' ');
      if (j + n <= p.words.length && isUnitWord(phrase)) {
        for (let k = 0; k < n; k++) {
          parts.push(p.words[j + k]);
          used.add(j + k);
        }
        j += n;
        matched = true;
        break;
      }
    }
    if (!matched) break;
  }
  // currency word before the number: "inr 5000"
  if (i > 0 && isCurrencyWord(p.words[i - 1]) && !TIME_UNITS.has(p.words[i - 1])) {
    parts.unshift(p.words[i - 1]);
    used.add(i - 1);
  }
  return { q: evalWords(parts, ctx), used };
}

const OPERATOR_WORDS = new Set(['+', '-', '*', '/', '^', '(', ')', 'x', 'times', 'plus', 'minus', 'mod', 'prev', 'ans', 'of', 'off', 'on', 'sqrt', 'cbrt', 'abs', 'round', 'floor', 'ceil', 'log', 'ln', 'root', 'fact']);
const ARITH_OPS = ['+', '-', '*', '/', '^', 'x', 'times', 'plus', 'minus'];

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

function requirePrevious(ctx: EvalContext, what: string): Quantity {
  const prev = lastValidResult(ctx);
  if (prev) return prev;
  const cleared = (ctx.contextStart ?? 0) > 0;
  throw new CalcError(`${what} = ?`, cleared ? 'context was cleared; no result since then' : 'no result above this line to work from');
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
  ops: Op[];
  /** the clause carried a GST rate ("1000 including 18% GST"): the final amount is split at this rate */
  gstRate?: Decimal;
  /** the percent operation kind came from an explicit verb (else it is inherited from a neighbouring clause) */
  explicitKind?: boolean;
  /** the clause followed "that"/"usmein"/"tar sathe": it operates on the running value */
  refersBack?: boolean;
}

interface RawClause {
  words: string[];
  refersBack: boolean;
}

function splitClauses(words: string[]): RawClause[] {
  const raw: RawClause[] = [];
  let cur: string[] = [];
  let refersBack = false;
  for (const w of words) {
    if (SEQUENCE_SPLIT.has(w)) {
      if (cur.length) raw.push({ words: cur, refersBack });
      cur = [];
      refersBack = w === 'that';
    } else cur.push(w);
  }
  if (cur.length) raw.push({ words: cur, refersBack });
  // a fragment without any number belongs to the clause before it ("5% aur badhao" → "5% increase")
  const out: RawClause[] = [];
  for (const c of raw) {
    const hasNumber = c.words.some((w) => NUM_RE.test(w) || PCT_RE.test(w));
    if (!hasNumber && out.length) out[out.length - 1].words.push(...c.words);
    else out.push(c);
  }
  return out;
}

/**
 * "1000 including 18% GST" / "25000 + 18% gst" inside a chain: the payable (GST-inclusive) amount is the
 * running value. Without an amount of its own ("then add 18% GST") it is a step that adds the tax.
 */
function gstClause(p: Parsed, ctx: EvalContext, c: Clause): Clause {
  const rate = pctAt(p, p.pcts[0]);
  const used = new Set<number>([p.pcts[0]]);
  const reverse = p.has('inclusive') || p.has('remove') || p.has('without') || p.has('base') || p.has('-') || p.has('minus');
  c.gstRate = rate;
  c.explicitKind = true;
  if (p.nums.length === 0) {
    c.ops.push(
      reverse
        ? { kind: 'div', amount: { kind: 'number', value: new Decimal(1).plus(rate.div(100)) }, label: `− GST ${formatNumber(rate)}%` }
        : { kind: 'pctInc', amount: { kind: 'percent', value: rate }, label: `+ GST ${formatNumber(rate)}%` },
    );
    return c;
  }
  const base = remainingBase(p, used, ctx);
  if (reverse) {
    c.value = base; // the stated amount already contains GST
  } else {
    c.value = moneyOrNumber(fin.gstAdd(base.value, rate).total, base);
  }
  return c;
}

function analyseClause(raw: RawClause, ctx: EvalContext): Clause {
  const words = raw.words;
  const p = analyse(words, []);
  p.isStartLike = p.has('start');
  const c: Clause = { words, p, isStart: p.has('start'), wantsTotal: p.has('total') || p.has('sum'), ops: [], refersBack: raw.refersBack };
  // a GST clause is one whose percentage sits next to the word GST ("18% GST", "GST 18%"); "10% discount before GST" is a discount
  const gstIdx = p.idx('gst');
  const gstPct = gstIdx >= 0 ? p.pcts.find((i) => Math.abs(i - gstIdx) <= 2 && !p.words.slice(Math.min(i, gstIdx) + 1, Math.max(i, gstIdx)).some((w) => w === 'discount' || w === 'before')) : undefined;
  if (gstPct !== undefined) {
    const gp: Parsed = { ...p, pcts: [gstPct, ...p.pcts.filter((i) => i !== gstPct)] };
    return gstClause(gp, ctx, c);
  }
  // "5 items cost 24.75 each", "3 pcs @ 120": quantity × unit price is a value
  if ((p.has('each') || p.has('items')) && p.nums.length >= 2 && p.pcts.length === 0) {
    const countIdx = p.nums.find((i) => p.words[i + 1] === 'items' || p.words[i - 1] === 'items') ?? p.nums[0];
    const priceIdx = p.nums.find((i) => i !== countIdx)!;
    const count = new Decimal(p.words[countIdx].replace(/[^\d.]/g, ''));
    const { q: price } = numberAt(p, priceIdx, ctx);
    c.value = moneyOrNumber(price.value.mul(count), price);
    c.name = undefined;
    return c;
  }
  // strong verbs first; a bare "on" only counts as "add" when nothing else says otherwise ("10% off on 1000" is a discount)
  const strongInc = Math.max(p.lastIdx('increase'), p.lastIdx('add'), p.lastIdx('plus'), p.lastIdx('+'), p.lastIdx('with'));
  const dec = Math.max(p.lastIdx('decrease'), p.lastIdx('remove'), p.lastIdx('minus'), p.lastIdx('-'), p.lastIdx('discount'), p.lastIdx('off'), p.lastIdx('without'), p.lastIdx('less'));
  const inc = strongInc >= 0 ? strongInc : dec < 0 && p.has('on') ? p.lastIdx('on') : -1;
  const mul = Math.max(p.lastIdx('times'), p.lastIdx('*'), p.lastIdx('x'));
  const div = Math.max(p.lastIdx('divide'), p.lastIdx('/'));
  const factor = p.has('double') ? 2 : p.has('triple') ? 3 : 0;

  if (p.pcts.length >= 1) {
    const refersBack = raw.refersBack || p.has('prev');
    // "subtract 35% of 240" / "add 10% of 500": the percentage of that number is the amount to add or subtract
    const ofIdx = p.idx('of');
    if (p.pcts.length === 1 && p.nums.length >= 1 && ofIdx >= 0 && (inc >= 0 || dec >= 0) && (p.nums.includes(ofIdx + 1) || p.nums.includes(ofIdx - 1))) {
      // English "35% of 240" and Hindi "240 ka 35%" both put the number next to "of"
      const { q } = numberAt(p, p.nums.includes(ofIdx + 1) ? ofIdx + 1 : ofIdx - 1, ctx);
      const amount = moneyOrNumber(q.value.mul(pctAt(p, p.pcts[0])).div(100), q);
      const kind: OpKind = dec > inc ? 'sub' : 'add';
      c.ops.push({ kind, amount, label: `${kind === 'add' ? '+' : '−'} ${formatQuantity(amount)} (${formatNumber(pctAt(p, p.pcts[0]))}% of ${formatQuantity(q)})` });
      c.explicitKind = true;
      return c;
    }
    const kind: OpKind = inc > dec && inc >= 0 ? 'pctInc' : dec >= 0 ? 'pctDec' : p.has('of') || refersBack ? 'pctOf' : 'pctInc';
    c.explicitKind = inc >= 0 || dec >= 0 || p.has('of') || refersBack;
    // every percentage in the clause is one step ("20% followed by another 10% discount")
    for (const i of p.pcts) {
      const pct = pctAt(p, i);
      c.ops.push({ kind, amount: { kind: 'percent', value: pct }, label: `${kind === 'pctInc' ? '+' : kind === 'pctDec' ? '−' : ''}${formatNumber(pct)}%${kind === 'pctOf' ? ' of' : ''}` });
    }
    // "10% of 500" / "18% discount on 1000": the number in the same clause is the base (start value)
    if (p.nums.length >= 1) {
      const { q } = numberAt(p, p.nums[0], ctx);
      if (kind === 'pctOf' && p.pcts.length === 1) {
        c.value = moneyOrNumber(q.value.mul(pctAt(p, p.pcts[0])).div(100), q);
        c.ops = [];
      } else c.value = q;
    }
    return c;
  }
  if (factor && p.nums.length === 0) {
    c.ops.push({ kind: 'mul', amount: { kind: 'number', value: new Decimal(factor) }, label: `×${factor}` });
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
      c.ops.push({ kind, amount: q, label: `${kind === 'add' ? '+' : kind === 'sub' ? '−' : kind === 'mul' ? '×' : '÷'} ${formatQuantity(q)}` });
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
 * "Rahul ko 150, Rohit ko 250, total kitna", "20% off then 10% off on 1000", "1000 including 18% GST, then 10% discount".
 */
function intentChain(p: Parsed, ctx: EvalContext): IntentResult | null {
  const markers = p.has('then') || p.has('that') || p.has('start') || p.has('another');
  if (!markers && !p.has(',') && !p.has('and')) return null;
  // specialised vocabulary (EMI, revenue, margin…) is handled by its own intent; GST and "N items at P each" may take part in a chain
  const gate = ['emi', 'interest', 'revenue', 'expenses', 'margin', 'markup', 'sell', 'loan', 'parts', 'people', 'equally', 'weekdays', 'weekends'];
  if (!p.has('each') && !p.has('items')) gate.push('cost');
  if (gate.some((w) => p.has(w))) return null;
  // dates ("days between 1 jan and 5 jan") belong to the date intent
  const dateToks = tokenize(p.words.filter((w) => w !== ',').join(' ')).filter((t) => t.type !== 'space');
  for (let i = 0; i < dateToks.length; i++) if (tryParseDate(dateToks, i, ctx.now(), ctx.zone)?.q.kind === 'date') return null;
  const clauses = splitClauses(p.words).map((w) => analyseClause(w, ctx));
  const numeric = clauses.filter((c) => c.p.nums.length || c.p.pcts.length);
  if (!markers && numeric.length < 2) return null;
  // "20% then 10% discount on 1000": a bare percentage takes its meaning from the nearest clause that states one
  clauses.forEach((c, i) => {
    if (!c.ops.length || c.explicitKind || !c.ops.every((op) => op.kind === 'pctInc')) return;
    const donor = clauses.slice(i + 1).find((d) => d.explicitKind && d.ops.length) ?? clauses.slice(0, i).reverse().find((d) => d.explicitKind && d.ops.length);
    if (!donor) return;
    const kind = donor.ops[0].kind;
    if (kind === 'pctInc' || kind === 'pctDec' || kind === 'pctOf') {
      c.ops = c.ops.map((op) => ({ ...op, kind, label: `${kind === 'pctInc' ? '+' : kind === 'pctDec' ? '−' : ''}${formatNumber(op.amount.value)}%${kind === 'pctOf' ? ' of' : ''}` }));
    }
  });
  const ops = clauses.filter((c) => c.ops.length);
  const values = clauses.filter((c) => c.value);
  const wantsTotal = clauses.some((c) => c.wantsTotal);
  const named = values.filter((c) => c.name);
  const gstRate = clauses.find((c) => c.gstRate)?.gstRate;

  // named amounts with a total: "rahul 150, rohit 250, total?"
  if (wantsTotal && values.length >= 2 && ops.length === 0) {
    let acc: Quantity = values[0].value!;
    for (const c of values.slice(1)) acc = applyOp(acc, { kind: 'add', amount: c.value!, label: '' }, ctx);
    const defines: Record<string, Quantity> = {};
    for (const c of named) defines[c.name!] = c.value!;
    return { ...acc, note: values.map((c) => `${c.name ? c.name + ' ' : ''}${formatQuantity(c.value!)}`).join(' + '), defines: Object.keys(defines).length ? defines : undefined };
  }
  if (ops.length === 0) {
    if (gstRate && values.length === 1) return null; // plain GST question, let intentGst answer it
    return null;
  }
  // starting value: an explicit "starting at", else the first clause that carries a value, else the running result above
  const startClause = clauses.find((c) => c.isStart && c.value) ?? values[0];
  let start: Quantity;
  if (startClause) start = startClause.value!;
  else if (p.has('that') || p.has('prev')) start = requirePrevious(ctx, 'that');
  else throw new CalcError('starting amount?', 'e.g. … starting at 50000');
  let acc: Quantity = start;
  const trail = [formatQuantity(acc)];
  for (const c of clauses) {
    for (const op of c.ops) {
      const before = acc;
      acc = applyOp(acc, op, ctx);
      // each step shows what it did ("4,500 (−10% = 500)", "5,310 (+ GST 18%)")
      const step = op.kind === 'pctDec' || op.kind === 'pctInc' ? `${op.label} = ${formatQuantity(moneyOrNumber(acc.value.minus(before.value).abs(), acc))}` : op.label;
      trail.push(`${formatQuantity(acc)} (${step})`);
    }
  }
  const delta = acc.value.minus(start.value);
  let note = trail.join(' → ');
  const onlyPercentOf = clauses.every((c) => c.ops.every((op) => op.kind === 'pctOf'));
  if (!onlyPercentOf && !delta.isZero() && !start.value.isZero() && acc.kind === start.kind) {
    const pct = fin.pct2(delta.div(start.value).mul(100));
    note += ` · ${delta.isNegative() ? '−' : '+'}${formatQuantity(moneyOrNumber(delta.abs(), start))} (${formatNumber(pct.abs())}%)`;
  }
  if (gstRate) {
    // split the final payable amount at the GST rate so base and tax stay visible after the operations
    const r = fin.gstRemove(acc.value, gstRate);
    note += ` · taxable value ${formatQuantity(moneyOrNumber(r.base, acc))} · GST ${formatQuantity(moneyOrNumber(r.tax, acc))} @ ${formatNumber(gstRate)}%`;
  }
  return { ...acc, note };
}

/**
 * Allocation: "Split 96000 into 25% rent, 18% food, 12% travel, 15% savings and remaining other expenses"
 * → each share, the remainder, and the names defined for later lines.
 */
function intentAllocate(p: Parsed, ctx: EvalContext): IntentResult | null {
  if (p.pcts.length < 2 || p.nums.length < 1) return null;
  if (!(p.has('divide') || p.has('in') || p.has('remaining') || p.has('parts'))) return null;
  if (['gst', 'discount', 'emi', 'interest', 'then', 'that'].some((w) => p.has(w))) return null;
  const { q: total } = numberAt(p, p.nums[0], ctx);
  const shares: { name: string; pct: Decimal; value: Quantity }[] = [];
  let sum = new Decimal(0);
  for (const i of p.pcts) {
    const pct = pctAt(p, i);
    // the label is the name word right after the percentage ("25% rent"), else right before it ("rent 25%")
    const after = p.words[i + 1];
    const before = p.words[i - 1];
    const name = after && isNameWord(after, ctx) ? after : before && isNameWord(before, ctx) ? before : `part ${shares.length + 1}`;
    sum = sum.plus(pct);
    shares.push({ name, pct, value: moneyOrNumber(total.value.mul(pct).div(100), total) });
  }
  if (sum.gt(100)) throw new CalcError(`shares add up to ${formatNumber(sum)}%`, 'they must not exceed 100%');
  let remainder: { name: string; value: Quantity } | undefined;
  if (p.has('remaining') || sum.lt(100)) {
    const ri = p.idx('remaining');
    const after = ri >= 0 ? p.words.slice(ri + 1).find((w) => isNameWord(w, ctx) || w === 'expenses') : undefined;
    remainder = { name: after ?? 'remaining', value: moneyOrNumber(total.value.minus(total.value.mul(sum).div(100)), total) };
  }
  const all = [...shares.map((s) => ({ name: s.name, value: s.value })), ...(remainder ? [remainder] : [])];
  const defines: Record<string, Quantity> = {};
  for (const a of all) if (isNameWord(a.name, ctx) || a.name === 'expenses') defines[a.name] = a.value;
  return {
    ...total,
    display: all.map((a) => formatQuantity(a.value)).join(' / '),
    note: all.map((a) => `${a.name} ${formatQuantity(a.value)}`).join(' · ') + (remainder ? ` · remaining ${formatNumber(new Decimal(100).minus(sum))}%` : ''),
    defines,
  };
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
    const a = dates[0].q.date!.startOf('day');
    const b = dates[1].q.date!.startOf('day');
    const span = `${a.toFormat('d LLL yyyy')} → ${b.toFormat('d LLL yyyy')}`;
    if (p.has('weekdays') || p.has('weekends')) {
      // count calendar days in [a, b] (inclusive: "from … through …", "… inclusive")
      let weekdays = 0;
      let weekends = 0;
      for (let d = a; d <= b; d = d.plus({ days: 1 })) {
        if (d.weekday <= 5) weekdays++;
        else weekends++;
      }
      const n = p.has('weekends') ? weekends : weekdays;
      const what = p.has('weekends') ? 'weekend days' : 'weekdays';
      return { kind: 'number', value: new Decimal(n), display: `${formatNumber(new Decimal(n))} ${what}`, note: `${span} inclusive · Mon–Fri${p.has('weekends') ? ' excluded' : ''}` };
    }
    const inclusive = p.has('inclusive');
    const days = b.diff(a, 'days').days + (inclusive ? 1 : 0);
    return { kind: 'unit', value: new Decimal(days), unit: 'day', note: `${span}${inclusive ? ' inclusive' : ''}` };
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
    // "days until 25 dec 2026", "25 dec tak kitne din", "how many days to 1 jan 2027" → from today
    if ((p.has('days') || p.has('day')) && (p.has('to') || p.has('between') || p.has('what')) && !dates[0].q.display) {
      const today = ctx.now().startOf('day');
      const days = d.startOf('day').diff(today, 'days').days;
      return { kind: 'unit', value: new Decimal(days), unit: 'day', note: `${today.toFormat('d LLL yyyy')} → ${d.toFormat('d LLL yyyy')}` };
    }
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
  // what is asked: the interest earned (default) or the amount at the end ("total amount", "maturity", "kitna milega")
  const totalIdx = p.idx('total');
  const wantsTotal = totalIdx >= 0 && p.words[totalIdx + 1] !== 'interest';
  const kind = p.has('compound') ? 'compound' : 'simple';
  let interest: Decimal;
  let total: Decimal;
  let label: string;
  if (kind === 'compound') {
    const freq: fin.Compounding = p.has('monthly') ? 'monthly' : p.has('quarterly') ? 'quarterly' : p.has('half-yearly') ? 'half-yearly' : p.has('daily') ? 'daily' : 'yearly';
    const r = fin.compoundInterest(principal.value, rate, years, freq);
    interest = r.interest;
    total = r.total;
    label = `compound ${freq}`;
  } else {
    const r = fin.simpleInterest(principal.value, rate, years);
    interest = r.interest;
    total = r.total;
    label = 'simple interest';
  }
  const tenure = `${formatNumber(principal.value)} @ ${formatNumber(rate)}% · ${formatNumber(years)} yr`;
  if (wantsTotal) {
    const q = moneyOrNumber(total, principal);
    return { ...q, note: `amount after ${label} · interest ${formatQuantity(moneyOrNumber(interest, principal))} · ${tenure}` };
  }
  const q = moneyOrNumber(interest, principal);
  return { ...q, note: `${label} · total ${formatQuantity(moneyOrNumber(total, principal))} · ${tenure}` };
}

/** "50000 divided equally among 3 people", "50000 ke 3 bhag karo", "50000 ko 3 logon mein divide karo" */
/** "3 items at ₹120 each", "5 pcs @ 24.75 each" → quantity × unit price */
function intentQuantity(p: Parsed, ctx: EvalContext): Quantity | null {
  if (!(p.has('each') || p.has('items')) || p.nums.length !== 2 || p.pcts.length) return null;
  if (p.has('divide') || p.has('parts') || p.has('equally') || p.has('people')) return null;
  const countIdx = p.nums.find((i) => p.words[i + 1] === 'items' || p.words[i - 1] === 'items') ?? p.nums[0];
  const priceIdx = p.nums.find((i) => i !== countIdx)!;
  const count = new Decimal(p.words[countIdx].replace(/[^\d.]/g, ''));
  const { q: price } = numberAt(p, priceIdx, ctx);
  return { ...moneyOrNumber(price.value.mul(count), price), note: `${formatNumber(count)} × ${formatQuantity(price)}` };
}

function intentDivide(p: Parsed, ctx: EvalContext): Quantity | null {
  const marker = p.has('divide') || p.has('parts') || p.has('equally') || p.has('people');
  if (!marker || p.nums.length < 2) return null;
  // the count is the number next to people/parts/equally, else the second number
  let countIdx = -1;
  for (const i of p.nums) {
    const next = p.words[i + 1];
    const prev = p.words[i - 1];
    if (['people', 'parts', 'equally', 'each'].includes(next) || ['parts', 'people'].includes(prev)) {
      countIdx = i;
      break;
    }
  }
  const amountIdx = p.nums.find((i) => i !== countIdx) ?? p.nums[0];
  if (countIdx < 0) countIdx = p.nums.find((i) => i !== amountIdx) ?? -1;
  if (countIdx < 0) return null;
  const { q: amount } = numberAt(p, amountIdx, ctx);
  const count = new Decimal(p.words[countIdx].replace(/[^\d.]/g, ''));
  if (count.isZero()) throw new CalcError('division by zero', 'the number of parts is 0');
  const exact = amount.value.div(count);
  const rounded = exact.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  const each = moneyOrNumber(rounded, amount);
  const exactText = exact.decimalPlaces() > 2 ? ` · exact ${formatNumber(exact, { maxDecimals: 6 })} (rounded)` : '';
  return {
    ...moneyOrNumber(exact, amount),
    display: `${formatQuantity(each)} each`,
    note: `${formatQuantity(amount)} ÷ ${formatNumber(count)}${exactText}`,
  };
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
  const profitMarker = expMarker < 0 && p.has('profit') ? p.idx('profit') : -1;
  if (expMarker < 0 && profitMarker < 0) return null;
  const used = new Set<number>();
  const revIdx = numberNear(p, revMarker, used);
  if (revIdx === undefined) throw new CalcError('revenue amount?', 'e.g. revenue 500000, expenses 350000');
  used.add(revIdx);
  const { q: revenue } = numberAt(p, revIdx, ctx);
  let expenses: Quantity;
  let profit: Decimal;
  const expIdx = expMarker >= 0 ? numberNear(p, expMarker, used) : undefined;
  if (expIdx !== undefined) {
    expenses = numberAt(p, expIdx, ctx).q;
    profit = fin.money2(revenue.value.minus(expenses.value));
  } else if (expMarker >= 0 && p.has('profit') && numberNear(p, p.idx('profit'), used) !== undefined) {
    // "revenue 12 lakh, profit 1.8 lakh, expenses?" → the expenses are what is asked
    const profIdx = numberNear(p, p.idx('profit'), used)!;
    profit = numberAt(p, profIdx, ctx).q.value;
    expenses = moneyOrNumber(revenue.value.minus(profit), revenue);
    return { ...expenses, display: `${formatQuantity(expenses)} expenses`, note: `revenue ${formatQuantity(revenue)} − profit ${formatQuantity(moneyOrNumber(profit, revenue))}` };
  } else if (expMarker >= 0) {
    throw new CalcError('expenses amount?', 'e.g. revenue 500000, expenses 350000');
  } else {
    // "revenue 12 lakh and net profit 1.8 lakh, margin?" — the profit is given, expenses follow from it
    const profIdx = numberNear(p, profitMarker, used);
    if (profIdx === undefined) throw new CalcError('profit amount?', 'e.g. revenue 12 lakh, profit 1.8 lakh');
    profit = numberAt(p, profIdx, ctx).q.value;
    expenses = moneyOrNumber(revenue.value.minus(profit), revenue);
  }
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
    // the stored value keeps full precision (later "10% of that" uses it); the display is the rounded money amount
    const exact = base.value.div(new Decimal(1).plus(rate.div(100)));
    return { ...moneyOrNumber(exact, base), display: formatQuantity(moneyOrNumber(r.base, base)), note: `before GST · GST ${formatQuantity(moneyOrNumber(r.tax, base))} · total ${formatQuantity(base)} @ ${formatNumber(rate)}%` };
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
    const off = base.value.minus(v);
    return { ...moneyOrNumber(v, base), note: `${trail.join(' → ')} · total discount ${formatQuantity(moneyOrNumber(off, base))} (${formatNumber(fin.pct2(off.div(base.value).mul(100)))}% effective)` };
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

/** 20% of what is 30 cm · 30 is what % of 150 · from 50000 to 57500 % increase · 150 to 200 % change · 2500 taka 5% */
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
  // reverse percentage: "840 is 12% less than what original amount" → 840 / 0.88; "750 is 20% more than what number" → 750 / 1.2;
  // "what original amount becomes 3910 after a 15% increase" → 3910 / 1.15
  if (p.nums.length === 1 && p.pcts.length === 1 && (p.has('than') || p.has('from') || p.has('after') || p.has('before')) && wi >= 0 && (p.has('increase') || p.has('decrease'))) {
    const pct = pctAt(p, p.pcts[0]);
    const { q: x } = numberAt(p, p.nums[0], ctx);
    const factor = p.has('decrease') ? new Decimal(100).minus(pct) : new Decimal(100).plus(pct);
    if (factor.lte(0)) throw new CalcError('percentage must be below 100%');
    const original = x.value.div(factor).mul(100);
    const shown = moneyOrNumber(original.toDecimalPlaces(2, Decimal.ROUND_HALF_UP), x);
    return { ...moneyOrNumber(original, x), display: formatQuantity(shown), note: `${formatQuantity(x)} is ${formatNumber(pct)}% ${p.has('decrease') ? 'less' : 'more'} than ${formatQuantity(shown)}` };
  }
  // "2500 taka 5%", "2500 takar 5 percent ber koro", "2500 theke 5% koto": one amount, one percent, no operation word → percent of
  if (p.nums.length === 1 && p.pcts.length === 1 && !w.some((x) => OPERATION_WORDS.has(x))) {
    const pct = pctAt(p, p.pcts[0]);
    const { q: x } = numberAt(p, p.nums[0], ctx);
    return { ...moneyOrNumber(x.value.mul(pct).div(100), x), note: `${formatNumber(pct)}% of ${formatQuantity(x)}` };
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
    intentEmi, intentInterest, intentBusiness, intentAllocate, intentChain, intentMarginMarkup, intentGst, intentDiscount, intentProfitLoss, intentDates, intentQuantity, intentDivide, intentPercentQuestions, intentIncreaseDecrease, intentConvert,
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
  // an unknown word ("rahul * 2" with no rahul, "call rahul 5pm") must surface as an error or text, never be
  // silently dropped to produce a confident number; known filler/verb vocabulary is handled by normalize
  const droppedNames = words.filter((w) => !keep.includes(w) && isNameWord(w, ctx) && !ctx.variables.has(w) && !CONNECTORS.has(w) && !VERBS.has(w) && w !== 'prev' && w !== 'that');
  if (droppedNames.length) return null;
  // an incomplete expression ("5 +") must stay an error, not be trimmed into "5"
  const ops = (ws: string[]) => ws.filter((w) => ARITH_OPS.includes(w)).length;
  if (ops(words) !== ops(keep)) return null;
  // keep conversion words between operands ("100 dollar in rupee")
  const withConv = words.filter((w) => keep.includes(w) || w === 'in' || w === 'to' || w === 'of' || w === 'off' || w === 'on' || w === 'prev' || w === 'that').map((w) => (w === 'that' ? 'prev' : w));
  while (withConv.length && ['of', 'on', 'in', 'to', 'off'].includes(withConv[withConv.length - 1])) withConv.pop();
  while (withConv.length && ['of', 'on', 'in', 'to', 'off'].includes(withConv[0])) withConv.shift();
  if (withConv.length === 0) return null;
  return withConv.join(' ');
}
