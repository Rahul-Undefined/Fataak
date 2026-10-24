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
import { Decimal, CalcError, lastValidResult, own, type EvalContext, type Quantity } from '../types';
import { normalize } from './normalize';
import { parse } from '../parser';
import { evaluate, convertMoney, add as addQuantities, traced } from '../evaluator';
import * as fin from '../finance';
import { formatQuantity, formatNumber } from '../format';
import { findZones, convertTime, tzResultQuantity, nowInZone, type ZoneRef } from '../timezone';
import { tokenize } from '../tokenizer';
import { tryParseDate } from '../dates';
import { isCurrencyWord, currencyBySymbol, findCurrency } from '../currency';
import { isUnitWord, findUnit } from '../units';
import { lookupFact } from '../facts';
import { lookupFixed } from '../fixed';
import { extraIntents } from '../extras';
import { div as divQ, mul as mulQ } from '../evaluator';
import { KEYWORDS } from '../parser';
import { CANON_KEYWORDS, SOURCE_WORDS } from './normalize';

const PCT_RE = /^(\d+(?:\.\d+)?)%$/;
const NUM_RE = /^-?[₹$€£¥৳]?\d[\d,]*(?:\.\d+)?$/;
const TIME_UNITS = new Set(['years', 'months', 'weeks', 'days', 'hours', 'minutes']);
const CONNECTORS = new Set(['of', 'on', 'in', 'to', 'from', 'for', 'at', 'by', 'and', 'with', 'what', 'after', 'before', 'between', 'is', 'than', 'then', 'now', 'time', ',', 'another', 'that', 'start', 'each', 'equally', 'people', 'compute']);
const VERBS = new Set([
  'increase', 'decrease', 'add', 'remove', 'inclusive', 'without', 'gst', 'discount', 'profit', 'loss', 'cost', 'sell', 'margin', 'markup', 'emi', 'loan', 'interest', 'simple', 'compound', 'convert', 'change',
  'revenue', 'expenses', 'double', 'triple', 'divide', 'total', 'sum', 'base', 'parts', 'reset', 'ratio', 'average', 'median', 'max', 'min', 'flat', 'reverse', 'age', 'born', 'leap', 'weekday', 'weekdays', 'weekends',
  'owes', 'pays', 'cogs', 'received', 'had', 'return', 'lcm', 'gcd', 'mode', 'remaining', 'itax', 'sip', 'fd', 'rd', 'ctc', 'inhand', 'lumpsum', 'prepay', 'inflation', 'deposit', 'bill', 'bmr', 'tdee', 'std', 'variance', 'percentile',
]);
const SCALE_WORDS = new Set(['k', 'thousand', 'hazaar', 'hazar', 'hajar', 'lakh', 'lakhs', 'lac', 'lacs', 'crore', 'crores', 'cr', 'koti', 'lokkho', 'million', 'mn', 'billion', 'bn', 'hundred']);
const SEQUENCE_SPLIT = new Set([',', 'then', 'and', 'that', 'after']);
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

export function analyse(words: string[], notes: string[]): Parsed {
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
export function evalWords(words: string[], ctx: EvalContext): Quantity {
  const text = words.join(' ');
  if (!text.trim()) throw new CalcError('amount?', 'add the amount');
  const node = parse(text, { variables: new Set(ctx.variables.keys()), now: ctx.now(), zone: ctx.zone });
  return evaluate(node, ctx);
}

/** A number token (possibly with currency symbol / following scale word / currency word / unit) → Quantity. */
export function numberAt(p: Parsed, i: number, ctx: EvalContext): { q: Quantity; used: Set<number> } {
  const used = new Set<number>([i]);
  const parts = [p.words[i]];
  let j = i + 1;
  let gotCurrency = false;
  let gotUnit = false;
  for (;;) {
    if (j >= p.words.length) break;
    const w = p.words[j];
    // a second currency or unit word is a conversion target ("100 dollar rupee", "5 km miles"), not part of the amount
    const cur = isCurrencyWord(w) && !gotCurrency;
    const unit = isUnitWord(w) && !TIME_UNITS.has(w) && !gotUnit && !gotCurrency;
    if (SCALE_WORDS.has(w) || cur || unit) {
      if (cur) gotCurrency = true;
      if (unit) gotUnit = true;
      parts.push(w);
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

const EXPR_WORD_MAP: Record<string, string> = { add: '+', plus: '+', minus: '-', times: '*', divide: '/', mod: 'mod' };
const EXPR_FNS = new Set(['sqrt', 'cbrt', 'abs', 'round', 'floor', 'ceil', 'log', 'ln', 'log2', 'exp', 'root', 'fact', 'lcm', 'gcd', 'mode', 'avg', 'average', 'sum', 'median', 'min', 'max', 'sin', 'cos', 'tan']);
const LIST_FN_WORDS = new Set(['avg', 'average', 'sum', 'median', 'min', 'max', 'lcm', 'gcd', 'mode']);
const EXPR_PUNCT = new Set(['+', '-', '*', '/', '^', '(', ')', ',', 'of', 'in', 'to', 'mod', '%']);

/**
 * Words that are nothing but arithmetic ("what 35% of 840 add 12% of 1250", "2 ^ 15") become one expression
 * for the parser; any other word means the sentence needs an intent. Never trims or drops a word.
 */
export function pureExpression(words: string[], ctx: EvalContext): string | null {
  const ws = words.slice();
  while (ws.length && (ws[0] === 'what' || ws[0] === 'compute' || ws[0] === 'is' || ws[0] === 'time')) ws.shift();
  const out: string[] = [];
  let operands = 0;
  let operators = 0;
  let fns = 0;
  let pcts = 0;
  for (let i = 0; i < ws.length; i++) {
    const w = ws[i];
    let unitLen = 0;
    for (let n = 3; n >= 2; n--) {
      if (i + n <= ws.length && isUnitWord(ws.slice(i, i + n).join(' '))) {
        unitLen = n;
        break;
      }
    }
    if (unitLen) {
      out.push(ws.slice(i, i + unitLen).join(' '));
      i += unitLen - 1;
      continue;
    }
    if (NUM_RE.test(w) || PCT_RE.test(w) || /^[(),.]*[\d₹$€£¥৳]/.test(w)) {
      operands++;
      if (PCT_RE.test(w)) pcts++;
      out.push(w);
      continue;
    }
    if (own(EXPR_WORD_MAP, w)) {
      operators++;
      out.push(EXPR_WORD_MAP[w]);
      continue;
    }
    if (w === 'x' && !ctx.variables.has('x')) {
      operators++;
      out.push('*');
      continue;
    }
    if (EXPR_PUNCT.has(w)) {
      if ('+-*/^'.includes(w)) operators++;
      out.push(w);
      continue;
    }
    // "multiplied by" / "divided by" keep their own (looser) precedence in the parser
    if (w === 'multipliedby' || w === 'dividedby') {
      operators++;
      out.push(w);
      continue;
    }
    if (EXPR_FNS.has(w)) {
      // "average of 10, 20, 30" is a list sentence; only "avg(10, 20, 30)" is a call
      if (LIST_FN_WORDS.has(w) && ws[i + 1] !== '(') return null;
      fns++;
      out.push(w);
      continue;
    }
    // "double 1000" (1000 ka dugna), "half 90", "half of 5000": a factor before its operand
    if (['double', 'triple', 'half', 'quarter'].includes(w)) {
      const nx = ws[i + 1] === 'of' ? ws[i + 2] : ws[i + 1];
      if (nx !== undefined && (NUM_RE.test(nx) || ctx.variables.has(nx) || nx === '(')) {
        fns++;
        out.push(w);
        if (ws[i + 1] === 'of') i++;
        continue;
      }
    }
    if (ctx.variables.has(w) || w === 'prev' || w === 'pi') {
      operands++;
      out.push(w);
      continue;
    }
    if (SCALE_WORDS.has(w) || isUnitWord(w) || isCurrencyWord(w) || !!currencyBySymbol(w)) {
      out.push(w);
      continue;
    }
    return null;
  }
  if (!operands || (!operators && !fns)) return null;
  // "50000 of 3 divide" (50000 ke 3 bhag karo) or "add 10%": a leading or trailing operator is not an expression
  const binary = new Set(['+', '*', '/', '^', 'of', 'in', 'to', 'mod', ',']);
  if (binary.has(out[0]) || binary.has(out[out.length - 1]) || out[out.length - 1] === '-') return null;
  // "5000 add 12%" stays with the increase/decrease intent, which explains the step in its note
  if (operands === 2 && operators === 1 && !fns && pcts === 1 && (out.includes('+') || out.includes('-'))) return null;
  return out.join(' ');
}

const OPERATOR_WORDS = new Set(['+', '-', '*', '/', '^', '(', ')', 'x', 'times', 'plus', 'minus', 'multipliedby', 'dividedby', 'mod', 'prev', 'ans', 'of', 'off', 'on', 'sqrt', 'cbrt', 'abs', 'round', 'floor', 'ceil', 'log', 'ln', 'root', 'fact', 'half', 'quarter', 'double', 'triple']);
const ARITH_OPS = ['+', '-', '*', '/', '^', 'x', 'times', 'plus', 'minus', 'multipliedby', 'dividedby'];

/** words that can take part in a base expression: numbers, variables, units, currencies, scales, operators */
function expressionWords(p: Parsed, used: Set<number>, ctx: EvalContext, keepPercents = false): string[] {
  // time units are part of an expression ("5 km + 2 hours" must fail loudly) unless an intent consumed them as a tenure
  const rest = p.words.filter(
    (w, i) => !used.has(i) && (!VERBS.has(w) || ctx.variables.has(w)) && (!CONNECTORS.has(w) || w === 'of' || w === 'on') && (keepPercents || (!PCT_RE.test(w) && w !== '%')) && (keepPercents || !TIME_UNITS.has(w)),
  );
  const keep = rest.filter(
    (w) => NUM_RE.test(w) || PCT_RE.test(w) || w === '%' || /^[(),.]*[\d₹$€£¥৳]/.test(w) || OPERATOR_WORDS.has(w) || ctx.variables.has(w) || SCALE_WORDS.has(w) || isUnitWord(w) || isCurrencyWord(w) || !!currencyBySymbol(w),
  );
  // multi-word variables ("basic salary") are matched as a phrase
  for (let n = 4; n >= 2; n--) {
    for (let i = 0; i + n <= rest.length; i++) {
      const phrase = rest.slice(i, i + n).join(' ');
      if (ctx.variables.has(phrase) && !keep.includes(phrase)) keep.push(phrase);
    }
  }
  const dangling = ['+', '-', '*', '/', '^', 'x', 'times', 'plus', 'minus', 'multipliedby', 'dividedby', 'of', 'off', 'on'];
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

export function moneyOrNumber(v: Decimal, like: Quantity): Quantity {
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
  if (VERBS.has(w) || CONNECTORS.has(w) || KEYWORDS.has(w) || CANON_KEYWORDS.has(w) || SOURCE_WORDS.has(w) || OPERATOR_WORDS.has(w)) return false;
  if (isUnitWord(w) || isCurrencyWord(w) || SCALE_WORDS.has(w) || TIME_UNITS.has(w)) return false;
  return true;
}

/** the currency named after the last "in"/"to" ("… in inr"), if any */
function targetCurrency(p: Parsed): string | undefined {
  for (let i = p.words.length - 1; i > 0; i--) {
    if ((p.words[i - 1] === 'in' || p.words[i - 1] === 'to') && isCurrencyWord(p.words[i])) return findCurrency(p.words[i])!.code;
  }
  return undefined;
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
  /** a word in the clause was not understood: the chain must not guess */
  invalid?: boolean;
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
  /** the clause came after the word "after": it happens before the clause it follows */
  precedes?: boolean;
  words: string[];
  refersBack: boolean;
}

function splitClauses(words: string[]): RawClause[] {
  const raw: RawClause[] = [];
  let cur: string[] = [];
  let refersBack = false;
  let precedes = false;
  // ("18% gst + 2% tds": the tax word also closes an operand)
  const operand = (w: string | undefined) => !!w && (NUM_RE.test(w) || PCT_RE.test(w) || isUnitWord(w) || isCurrencyWord(w) || SCALE_WORDS.has(w) || ['gst', 'discount', 'off', 'each', 'items'].includes(w));
  for (let k = 0; k < words.length; k++) {
    const w = words[k];
    if (SEQUENCE_SPLIT.has(w)) {
      if (cur.length) raw.push({ words: cur, refersBack, precedes });
      cur = [];
      refersBack = w === 'that';
      precedes = w === 'after';
    } else if (['add', 'plus', 'minus', 'remove', '+', '-'].includes(w) && w === words[k + 1]) {
      // "plus 5% service charge plus" → one operation word
      continue;
    } else if (['add', 'plus', 'minus', 'remove', '+', '-'].includes(w) && operand(words[k - 1]) && PCT_RE.test(words[k + 1] ?? '') && cur.length) {
      // "2500 add 5% add 18% gst": each "add P%" is a step of its own
      raw.push({ words: cur, refersBack, precedes });
      cur = [w];
      refersBack = false;
      precedes = false;
    } else cur.push(w);
  }
  if (cur.length) raw.push({ words: cur, refersBack, precedes });
  // "plus 18% GST after a 10% discount": the clause after "after" is applied first
  for (let i = 1; i < raw.length; i++) {
    if (raw[i].precedes) {
      const [c] = raw.splice(i, 1);
      raw.splice(i - 1, 0, { ...c, precedes: false });
    }
  }
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
function gstClause(p: Parsed, ctx: EvalContext, c: Clause, splitSteps = false): Clause {
  const rate = pctAt(p, p.pcts[0]);
  const used = new Set<number>([p.pcts[0]]);
  const reverse = p.has('inclusive') || p.has('remove') || p.has('without') || p.has('base') || p.has('-') || p.has('minus');
  c.explicitKind = true;
  // "30% tax katke" inside a chain: a deduction step, not GST to add
  const i0 = p.pcts[0];
  if (p.words[i0 + 1] === 'decrease' || p.words[i0 + 2] === 'decrease' || p.words[i0 - 1] === 'decrease') {
    c.ops.push({ kind: 'pctDec', amount: { kind: 'percent', value: rate }, label: `− tax ${formatNumber(rate)}%` });
    if (p.nums.length) c.value = remainingBase(p, used, ctx);
    return c;
  }
  c.gstRate = rate;
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
  } else if (splitSteps) {
    c.value = base;
    c.ops.push({ kind: 'pctInc', amount: { kind: 'percent', value: rate }, label: `+ GST ${formatNumber(rate)}%` });
  } else {
    c.value = moneyOrNumber(fin.gstAdd(base.value, rate).total, base);
  }
  return c;
}

function analyseClause(raw: RawClause, ctx: EvalContext, sentenceHasDiscount = false, sentenceWantsTotal = false): Clause {
  const c = analyseClauseInner(raw, ctx, sentenceHasDiscount, sentenceWantsTotal);
  c.invalid = hasUnknownWords(c, ctx);
  return c;
}

/** a letter word the chain did not account for ("rahul = 2450", "foo 5000") makes the clause unusable */
function hasUnknownWords(c: Clause, ctx: EvalContext): boolean {
  const ws = c.words;
  const ok = new Set<number>();
  for (let n = 4; n >= 2; n--) {
    for (let i = 0; i + n <= ws.length; i++) {
      const phrase = ws.slice(i, i + n).join(' ');
      if (ctx.variables.has(phrase) || isUnitWord(phrase) || findCurrency(phrase)) for (let k = i; k < i + n; k++) ok.add(k);
    }
  }
  const nameParts = new Set(c.name ? c.name.split(' ') : []);
  const extra = new Set(['prev', 'ans', 'what', 'first', 'last', 'then', 'another', 'items', 'each', 'people', 'equally', 'parts', 'half', 'quarter', 'per']);
  for (let i = 0; i < ws.length; i++) {
    const w = ws[i];
    if (ok.has(i) || !/^[\p{L}][\p{L}\p{N}_]*$/u.test(w)) continue;
    if (VERBS.has(w) || CONNECTORS.has(w) || OPERATOR_WORDS.has(w) || nameParts.has(w) || ctx.variables.has(w) || extra.has(w)) continue;
    if (SCALE_WORDS.has(w) || isCurrencyWord(w) || isUnitWord(w) || !!currencyBySymbol(w) || TIME_UNITS.has(w) || KEYWORDS.has(w)) continue;
    // "2.75 cubic metres of water": one descriptive noun after "of" that follows a unit
    if (i >= 2 && ws[i - 1] === 'of' && (ok.has(i - 2) || isUnitWord(ws[i - 2]))) continue;
    return true;
  }
  return false;
}

function analyseClauseInner(raw: RawClause, ctx: EvalContext, sentenceHasDiscount = false, sentenceWantsTotal = false): Clause {
  const words = raw.words;
  const p = analyse(words, []);
  p.isStartLike = p.has('start');
  const c: Clause = { words, p, isStart: p.has('start'), wantsTotal: p.has('total') || p.has('sum'), ops: [], refersBack: raw.refersBack };
  // "salary 68000 …", "invoice 4 items …": name words right before the first amount are the clause's subject
  const subject: string[] = [];
  for (const w of words) {
    if (isNameWord(w, ctx)) subject.push(w);
    else break;
  }
  const afterSubject = subject.length + (words[subject.length] === 'of' || words[subject.length] === 'cost' ? 1 : 0);
  if (subject.length && subject.length <= 3 && (p.nums.includes(afterSubject) || p.pcts.includes(afterSubject))) c.name = subject.join(' ');
  // a GST clause is one whose percentage sits next to the word GST ("18% GST", "GST 18%"); "10% discount before GST" is a discount
  const gstIdx = p.idx('gst');
  const gstPct = gstIdx >= 0 ? p.pcts.find((i) => Math.abs(i - gstIdx) <= 2 && !p.words.slice(Math.min(i, gstIdx) + 1, Math.max(i, gstIdx)).some((w) => w === 'discount' || w === 'before')) : undefined;
  if (gstPct !== undefined) {
    const gp: Parsed = { ...p, pcts: [gstPct, ...p.pcts.filter((i) => i !== gstPct)] };
    return gstClause(gp, ctx, c, sentenceHasDiscount);
  }
  // an arithmetic clause ("17.5% of 864 add 12.5% of 640", "(245 - 87) * 12") is a value, never a percentage step
  if (p.nums.length + p.pcts.length >= 3 || (p.nums.length >= 2 && p.pcts.length === 0)) {
    const pure = pureExpression(words, ctx);
    if (pure && /[+*/^]|\s-\s/.test(pure)) {
      c.value = evalWords([pure], ctx);
      c.explicitKind = true;
      return c;
    }
  }
  // "markup 25% on 400" / "margin 20% on 500" as a step: the selling price is the value
  if ((p.has('markup') || p.has('margin')) && p.pcts.length === 1 && p.nums.length >= 1) {
    const pct = pctAt(p, p.pcts[0]);
    const { q: cost } = numberAt(p, p.nums[0], ctx);
    const price = p.has('margin') ? fin.priceFromMargin(cost.value, pct) : fin.priceFromMarkup(cost.value, pct);
    if (price.isNaN()) throw new CalcError('margin must be below 100%');
    c.value = moneyOrNumber(price, cost);
    c.explicitKind = true;
    return c;
  }
  // "5 items cost 24.75 each", "3 pcs @ 120": quantity × unit price is a value
  if ((p.has('each') || p.has('items')) && p.nums.length >= 2 && p.pcts.length === 0) {
    const countIdx = p.nums.find((i) => p.words[i + 1] === 'items' || p.words[i - 1] === 'items') ?? p.nums[0];
    const priceIdx = p.nums.find((i) => i !== countIdx)!;
    const count = new Decimal(p.words[countIdx].replace(/[^\d.]/g, ''));
    const { q: price } = numberAt(p, priceIdx, ctx);
    c.value = moneyOrNumber(price.value.mul(count), price);
    return c;
  }
  // strong verbs first; a bare "on" only counts as "add" when nothing else says otherwise ("10% off on 1000" is a discount)
  const strongInc = Math.max(p.lastIdx('increase'), p.lastIdx('add'), p.lastIdx('plus'), p.lastIdx('+'), p.lastIdx('with'), p.lastIdx('profit'));
  const dec = Math.max(p.lastIdx('decrease'), p.lastIdx('remove'), p.lastIdx('minus'), p.lastIdx('-'), p.lastIdx('discount'), p.lastIdx('off'), p.lastIdx('without'), p.lastIdx('less'), p.lastIdx('loss'));
  // "successive discounts of 10% and 20% on 1000": the "on" names the base, it is not an addition
  const inc = strongInc >= 0 ? strongInc : dec < 0 && !sentenceHasDiscount && p.has('on') ? p.lastIdx('on') : -1;
  const mul = Math.max(p.lastIdx('times'), p.lastIdx('*'), p.lastIdx('x'));
  const div = Math.max(p.lastIdx('divide'), p.lastIdx('/'));
  const factor = p.has('double') ? 2 : p.has('triple') ? 3 : 0;

  if (p.pcts.length >= 1) {
    const refersBack = raw.refersBack || p.has('prev');
    // "subtract 35% of 240" / "add 10% of 500": the percentage of that number is the amount to add or subtract
    const ofIdx = p.idx('of');
    // (Hindi "usme se 240 ka 35% ghatao" puts the number before "of": only when the clause refers back to a running value)
    const amountAfterOf = p.nums.includes(ofIdx + 1) && p.pcts[0] < ofIdx;
    const amountBeforeOf = raw.refersBack && p.nums.includes(ofIdx - 1) && p.pcts[0] > ofIdx;
    if (p.pcts.length === 1 && p.nums.length >= 1 && ofIdx >= 0 && (inc >= 0 || dec >= 0) && (amountAfterOf || amountBeforeOf)) {
      const { q } = numberAt(p, amountAfterOf ? ofIdx + 1 : ofIdx - 1, ctx);
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
      } else if (sentenceWantsTotal) {
        // "gst 12% on 2500 and 18% on 4000, total": each clause is a line item of its own
        let v: Quantity = q;
        for (const op of c.ops) v = applyOp(v, op, ctx);
        if (c.ops.length === 1 && c.ops[0].kind === 'pctInc') c.gstRate = c.ops[0].amount.value;
        c.value = v;
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
    // a value clause: "rahul 150", "rohit of 500" (Hindi "ke"), "5000 of 0.5", "starting at 50000", "₹1,200"
    const leading: string[] = [];
    for (const w of words) {
      if (isNameWord(w, ctx)) leading.push(w);
      else break;
    }
    let after = leading.length;
    if (words[after] === 'of') after++;
    // "product cost 8500": the price of the named thing
    if (words[after] === 'cost' && p.nums.includes(after + 1)) after++;
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
      // "2.255 m³ + 125 litres": units convert to the running value's unit
      if (v.kind === 'unit' && a.kind === 'unit') return { ...addQuantities(v, a, ctx, op.kind === 'add' ? 1 : -1), note: undefined, display: undefined };
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
/** a unit word after "what"/"in"/"to" that no amount owns ("what litres remaining", "… in litres") */
function targetUnitWord(p: Parsed, fromUnit: string): string | null {
  const from = findUnit(fromUnit);
  for (let i = p.words.length - 1; i > 0; i--) {
    const w = p.words[i];
    const two = i >= 2 ? `${p.words[i - 1]} ${w}` : '';
    const text = isUnitWord(two) ? two : isUnitWord(w) ? w : null;
    if (!text) continue;
    const lead = text === two ? i - 2 : i - 1;
    if (!['what', 'in', 'to'].includes(p.words[lead])) continue;
    const u = findUnit(text);
    if (u && from && u.dim === from.dim && u.id !== from.id) return text;
    return null;
  }
  return null;
}

/** "6196 - 10% + 18% gst / 3", "(… ) / 3", "… split 3 ways", "… divided by 3": the divisor applies to the whole chain */
function trailingDivisor(words: string[]): { inner: string[]; divisor: string; label: string } | null {
  const w = words.slice();
  let divisor: string | null = null;
  let label = '';
  const n = w.length;
  if (n >= 3 && w[n - 1] === 'ways' && NUM_RE.test(w[n - 2]) && (w[n - 3] === 'split' || w[n - 3] === 'in')) {
    divisor = w[n - 2];
    label = `split ${divisor} ways`;
    w.splice(n - 3, 3);
  } else if (n >= 4 && (w[n - 1] === 'people' || w[n - 1] === 'persons' || w[n - 1] === 'friends' || w[n - 1] === 'parts') && NUM_RE.test(w[n - 2]) && ['between', 'among', 'in', 'by', '/', 'divide', 'split'].includes(w[n - 3])) {
    divisor = w[n - 2];
    label = `÷ ${divisor} people`;
    w.splice(n - 3, 3);
    if (w[w.length - 1] === 'split' || w[w.length - 1] === 'divide' || w[w.length - 1] === 'divided') w.pop();
  } else if (n >= 3 && NUM_RE.test(w[n - 1]) && (w[n - 2] === '/' || w[n - 2] === 'by') && (w[n - 2] === '/' || w[n - 3] === 'divide' || w[n - 3] === 'divided')) {
    divisor = w[n - 1];
    label = `÷ ${divisor}`;
    w.splice(w[n - 2] === '/' ? n - 2 : n - 3, w[n - 2] === '/' ? 2 : 3);
  }
  if (!divisor) return null;
  const inner = stripOuterParens(w);
  if (!inner) return null;
  return { inner, divisor, label };
}

/** "(6196 - 10% + 18% gst)" → the words inside; null when parentheses nest or sit elsewhere */
function stripOuterParens(words: string[]): string[] | null {
  const text = words.join(' ');
  const opens = (text.match(/\(/g) ?? []).length;
  const closes = (text.match(/\)/g) ?? []).length;
  if (opens === 0 && closes === 0) return words;
  if (opens !== 1 || closes !== 1) return null;
  const w = words.slice();
  if (!w[0]?.startsWith('(') || !w[w.length - 1]?.endsWith(')')) return null;
  w[0] = w[0].slice(1);
  w[w.length - 1] = w[w.length - 1].slice(0, -1);
  return w.filter(Boolean);
}

function intentChain(p: Parsed, ctx: EvalContext): IntentResult | null {
  // a chain wrapped in one pair of parentheses is the same chain
  if (p.words[0]?.startsWith('(') && p.words[p.words.length - 1]?.endsWith(')')) {
    const inner = stripOuterParens(p.words);
    if (inner && inner.length < p.words.length + 1 && inner.join(' ') !== p.words.join(' ')) return intentChain(analyse(inner, p.notes), ctx);
  }
  const tail = trailingDivisor(p.words);
  if (tail && tail.inner.some((w) => PCT_RE.test(w))) {
    const inner = analyse(tail.inner, p.notes);
    const base = intentChain(inner, ctx) ?? intentGst(inner, ctx) ?? intentDiscount(inner, ctx) ?? intentIncreaseDecrease(inner, ctx);
    if (base) {
      const dv = new Decimal(tail.divisor.replace(/,/g, ''));
      if (dv.isZero()) throw new CalcError('division by zero');
      const q: Quantity = { ...base, value: base.value.div(dv), display: undefined, note: `${formatQuantity({ ...base, display: undefined })} ${tail.label}${base.note ? ' · ' + base.note : ''}` };
      // a share per person reads "345 each"
      if (tail.label !== `÷ ${tail.divisor}`) q.display = `${formatQuantity(q)} each`;
      return q;
    }
  }
  // a question about one amount and one percentage ("what becomes 3910 after a 15% increase?") is never a chain
  // ("pichle mahine 45000 kamaye, is mahine 20% zyada, kitna" is a chain: an amount received/spent, then a step)
  if (p.has('what') && p.nums.length === 1 && p.pcts.length === 1 && !p.has('received') && !p.has('expenses')) return null;
  // "1500 ka 20% discount ke baad 18% gst": a discount and a tax in one sentence are always two steps
  const taxAndDiscount = p.has('discount') && p.has('gst') && p.pcts.length >= 2;
  // "cgst 9% and sgst 9% on 5000": every percentage next to a tax word is one combined rate, not a chain
  const taxIdx = p.words.map((w, i) => (w === 'gst' ? i : -1)).filter((i) => i >= 0);
  const nearGst = (i: number) => !['decrease', 'remove', 'discount', 'off'].includes(p.words[i + 1]) && taxIdx.some((t) => Math.abs(t - i) <= 2);
  if (taxIdx.length >= 2 && p.pcts.length >= 2 && p.pcts.every(nearGst) && !p.has('then') && !p.has(',')) return null;
  // "gst inclusive price 2360, rate 18%, base": one inclusive amount and one rate is a reverse-GST question
  if (p.has('inclusive') && p.has('gst') && p.pcts.length === 1) return null;
  // "2500 plus 5% service charge plus 18% gst": two percentages joined by operation words are steps
  const multiOps = p.pcts.length >= 2 && p.pcts.some((i) => !nearGst(i)) && p.words.some((w) => ['add', 'plus', '+', 'remove', 'minus', '-', 'discount', 'off', 'increase', 'decrease'].includes(w));
  const markers = p.has('then') || p.has('that') || p.has('start') || p.has('another') || taxAndDiscount || multiOps;
  if (!markers && !p.has(',') && !p.has('and')) return null;
  // specialised vocabulary (EMI, revenue…) is handled by its own intent; GST, markup/margin and "N items at P each" may take part in a chain
  const gate = ['emi', 'interest', 'revenue', 'expenses', 'sell', 'loan', 'parts', 'people', 'equally', 'weekdays', 'weekends', 'ratio', 'average', 'median'];
  if (!markers) gate.push('margin', 'markup');
  // "product costs 8500 … 12% discount … 18% GST": a price, not a profit/loss pair
  if (!p.has('each') && !p.has('items') && !p.has('gst') && !p.has('discount')) gate.push('cost');
  // "20% profit on 1500 then 10% loss on that": profit/loss as steps of a chain
  if (p.has('then') || p.has('that')) gate.splice(gate.indexOf('sell'), 1);
  if (gate.some((w) => p.has(w))) return null;
  // dates ("days between 1 jan and 5 jan") belong to the date intent
  // ("pichle mahine 45000 kamaye, is mahine 20% zyada": a month word next to amounts and percentages is context, not a date question)
  if (p.pcts.length === 0 && !p.has('received') && !p.has('expenses')) {
    const dateToks = tokenize(p.words.filter((w) => w !== ',').join(' ')).filter((t) => t.type !== 'space');
    for (let i = 0; i < dateToks.length; i++) if (tryParseDate(dateToks, i, ctx.now(), ctx.zone)?.q.kind === 'date') return null;
  }
  const sentenceHasDiscount = p.has('discount') || p.has('off');
  const sentenceWantsTotal = p.has('total') || p.has('sum');
  const clauses = splitClauses(p.words).map((w) => analyseClause(w, ctx, sentenceHasDiscount, sentenceWantsTotal));
  if (clauses.some((c) => c.invalid)) return null;
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

  // named amounts with a total: "rahul 150, rohit 250, total?" (converted when a currency is named: "… in inr")
  if (wantsTotal && values.length >= 2 && ops.length === 0) {
    // "gst 18% on 1 lakh and 5% on 50000, total gst": the taxes add up, not the payable amounts
    const ti = p.idx('total');
    if (values.every((c) => c.gstRate) && (p.words[ti + 1] === 'gst' || p.words[ti - 1] === 'gst')) {
      let tax = new Decimal(0);
      for (const c of values) tax = tax.plus(c.value!.value.minus(c.value!.value.div(new Decimal(1).plus(c.gstRate!.div(100)))));
      const like = values[0].value!;
      return { ...moneyOrNumber(tax, like), note: values.map((c) => `${formatQuantity(moneyOrNumber(c.value!.value.minus(c.value!.value.div(new Decimal(1).plus(c.gstRate!.div(100)))), like))} @ ${formatNumber(c.gstRate!)}%`).join(' + ') };
    }
    const target = targetCurrency(p);
    const first = target && values[0].value!.kind === 'money' ? convertMoney(values[0].value!, target, ctx) : values[0].value!;
    let acc: Quantity = { ...first, note: undefined };
    for (const c of values.slice(1)) {
      const v = target && c.value!.kind === 'money' ? convertMoney(c.value!, target, ctx) : c.value!;
      acc = applyOp(acc, { kind: 'add', amount: v, label: '' }, ctx);
    }
    const defines: Record<string, Quantity> = {};
    for (const c of named) defines[c.name!] = c.value!;
    return { ...acc, note: values.map((c) => `${c.name ? c.name + ' ' : ''}${formatQuantity(c.value!)}`).join(' + '), defines: Object.keys(defines).length ? defines : undefined };
  }
  if (ops.length === 0) {
    if (gstRate && values.length === 1) return null; // plain GST question, let intentGst answer it
    return null;
  }
  // starting value: an explicit "starting at"; else the value clauses before the first operation (several
  // line items add up to a subtotal: "2 items at 500, 3 items at 200, 18% gst"); else the running result above
  const explicitStart = clauses.find((c) => c.isStart && c.value);
  const firstOpAt = clauses.findIndex((c) => c.ops.length);
  const leadingValues = explicitStart ? [explicitStart] : clauses.slice(0, firstOpAt < 0 ? clauses.length : firstOpAt).filter((c) => c.value);
  let start: Quantity;
  let subtotalNote = '';
  if (leadingValues.length >= 2) {
    start = { ...leadingValues[0].value!, note: undefined };
    for (const c of leadingValues.slice(1)) start = applyOp(start, { kind: 'add', amount: c.value!, label: '' }, ctx);
    subtotalNote = `subtotal ${formatQuantity(start)} (${leadingValues.map((c) => formatQuantity(c.value!)).join(' + ')}) · `;
  } else if (leadingValues.length === 1) start = leadingValues[0].value!;
  else if (values.length) start = values[0].value!;
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
  // "how many litres remain" / "… in litres": the answer in the unit asked for
  if (acc.kind === 'unit') {
    const target = targetUnitWord(p, acc.unit!);
    if (target) {
      acc = evalWords([`${acc.value.toString()} ${acc.unit}`, 'in', target], ctx);
      trail.push(formatQuantity(acc));
    }
  }
  let note = subtotalNote + trail.join(' → ');
  const allOps = clauses.flatMap((c) => c.ops);
  const onlyPercentOf = allOps.every((op) => op.kind === 'pctOf');
  const trivial = allOps.length === 1 && (allOps[0].kind === 'add' || allOps[0].kind === 'sub' || allOps[0].kind === 'mul' || allOps[0].kind === 'div');
  if (!onlyPercentOf && !trivial && !delta.isZero() && !start.value.isZero() && acc.kind === start.kind && (acc.kind !== 'unit' || acc.unit === start.unit)) {
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
  if (zones.length === 0) {
    // "abhi 10 baje hain, 3 ghante 45 minute baad kitne bajenge": a clock time shifted by the offset
    if (time && hasOffset && (wordList.includes('time') || wordList.includes('after') || wordList.includes('before'))) {
      const d = ctx.now().startOf('day').set({ hour: time.hour, minute: time.minute }).plus({ seconds: offsetSeconds });
      return { kind: 'time', value: new Decimal(d.toMillis()), date: d, note: `${String(time.hour).padStart(2, '0')}:${String(time.minute).padStart(2, '0')} ${offsetSeconds < 0 ? '−' : '+'} ${formatNumber(new Decimal(Math.abs(offsetSeconds) / 3600))} h` };
    }
    // "2 ghante baad kitne baje honge" / "what time is it in 2 hours": the local clock shifted
    if (!time && hasOffset && wordList.includes('time')) {
      const base = ctx.now().plus({ seconds: offsetSeconds });
      const q = nowInZone({ zone: ctx.zone, label: 'local' }, base);
      const h = Math.abs(offsetSeconds) / 3600;
      q.note = `now ${offsetSeconds < 0 ? '−' : '+'} ${h >= 1 ? `${formatNumber(new Decimal(h))} h` : `${Math.round(Math.abs(offsetSeconds) / 60)} min`}`;
      return q;
    }
    return null;
  }
  // "3pm IST to XYZ": a time, one zone, and an unknown word after "to"/"in" → say the place is unknown
  if (time && zones.length === 1) {
    const toIdx = Math.max(wordList.lastIndexOf('to'), wordList.lastIndexOf('in'));
    const after = toIdx >= 0 ? wordList.slice(toIdx + 1).filter((w) => /^[\p{L}]+$/u.test(w) && w !== 'time') : [];
    if (toIdx > zones[0].end - 1 && after.length) throw new CalcError(`unknown place or zone "${after.join(' ')}"`, 'try a city (New York) or an abbreviation (EST, CET)');
  }
  // "time difference between india and london", "ist se pst kitna peeche hai": the gap between two zones now
  if (zones.length >= 2 && !time && zones[0].ref.zone !== zones[1].ref.zone && !wordList.some((w) => PCT_RE.test(w)) && (wordList.includes('difference') || wordList.includes('behind') || wordList.includes('ahead'))) {
    const now = ctx.now();
    const offA = now.setZone(zones[0].ref.zone).offset;
    const offB = now.setZone(zones[1].ref.zone).offset;
    const diff = Math.abs(offA - offB);
    const h = Math.floor(diff / 60);
    const m = diff % 60;
    const ahead = offA > offB ? zones[0].ref.label : zones[1].ref.label;
    const behind = offA > offB ? zones[1].ref.label : zones[0].ref.label;
    return { kind: 'unit', value: new Decimal(diff).div(60), unit: 'h', display: m ? `${h} h ${m} min` : `${h} h`, note: diff === 0 ? 'same time' : `${ahead} is ahead of ${behind} right now` };
  }
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
    // "10:30 pm ist to 6:45 am gmt, duration": two clock times in two zones is a span
    const times: { hour: number; minute: number; idx: number }[] = [];
    for (let i = 0; i < toks.length; i++) {
      if (toks[i].type !== 'number') continue;
      const r = tryParseDate(toks, i, ctx.now(), ctx.zone);
      if (r && r.q.kind === 'time') {
        times.push({ hour: r.q.date!.hour, minute: r.q.date!.minute, idx: i });
        i += r.consumed - 1;
      }
    }
    if (times.length === 2) {
      const base = ctx.now().startOf('day');
      const at = (t: { hour: number; minute: number }, z: ZoneRef) => base.setZone(z.zone, { keepLocalTime: true }).set({ hour: t.hour, minute: t.minute });
      const start = at(times[0], zones[0].ref);
      let end = at(times[1], zones[1].ref);
      if (end <= start) end = end.plus({ days: 1 });
      const minutes = end.diff(start, 'minutes').minutes;
      const h = Math.floor(minutes / 60);
      const m = Math.round(minutes - h * 60);
      return { kind: 'unit', value: new Decimal(minutes).div(60), unit: 'h', display: m === 0 ? `${h} h` : `${h} h ${m} min`, note: `${start.toFormat('h:mm a')} ${zones[0].ref.label} → ${end.toFormat('h:mm a')} ${zones[1].ref.label}` };
    }
    // "what time in sydney when it is 9am in mumbai": the zone nearest the clock time is the source
    const timeWord = wordList.findIndex((w) => /^\d{1,2}(?::\d{2})?(?:am|pm)?$/.test(w) && parseInt(w, 10) % 12 === time!.hour % 12);
    const dist = (z: { start: number }) => (timeWord < 0 ? Infinity : Math.abs(z.start - timeWord));
    const nearest = zones.reduce((best, z) => (dist(z) < dist(best) ? z : best), zones[0]);
    const other = zones.find((z) => z !== nearest)!;
    fromRef = timeWord < 0 ? zones[0].ref : nearest.ref;
    toRef = timeWord < 0 ? zones[1].ref : other.ref;
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

function countWeekdays(a: DateTime, b: DateTime): { weekdays: number; weekends: number } {
  let weekdays = 0;
  let weekends = 0;
  for (let d = a; d <= b; d = d.plus({ days: 1 })) {
    if (d.weekday <= 5) weekdays++;
    else weekends++;
  }
  return { weekdays, weekends };
}

function weekdayResult(p: Parsed, a: DateTime, b: DateTime, span: string): Quantity {
  const c = countWeekdays(a, b);
  const n = p.has('weekends') ? c.weekends : c.weekdays;
  const what = p.has('weekends') ? 'weekend days' : 'weekdays';
  return { kind: 'number', value: new Decimal(n), display: `${formatNumber(new Decimal(n))} ${what}`, note: `${span} inclusive · Mon–Fri${p.has('weekends') ? ' excluded' : ''}` };
}

/** "hours between 9am and 5:30pm", "9am to 5pm minus 30 min break", "sokal 10 ta theke bikel 5 ta koto ghonta" */
function intentTimeSpan(p: Parsed, ctx: EvalContext): Quantity | null {
  const w = p.words.filter((x) => x !== ',');
  const toks = tokenize(w.join(' ')).filter((t) => t.type !== 'space');
  const times: DateTime[] = [];
  for (let i = 0; i < toks.length; ) {
    const r = tryParseDate(toks, i, ctx.now(), ctx.zone);
    if (r && r.q.kind === 'time') {
      times.push(r.q.date!);
      i += r.consumed;
    } else i++;
  }
  if (times.length !== 2) return null;
  if (!(p.has('to') || p.has('between') || p.has('from') || p.has('and') || p.has('-'))) return null;
  let [start, end] = times;
  // "10 baje se 5 baje tak": an end before the start on a 12-hour clock means the afternoon — unless the end was
  // written unambiguously ("00:15", "05:00", "6am"), in which case it is the next day
  const timeWords = w.filter((x, k) => /^\d{1,2}(?::\d{2})?(?:am|pm)?$/.test(x) && (x.includes(':') || /am|pm/.test(x) || ['am', 'pm', 'baje', "o'clock"].includes(w[k + 1] ?? '')));
  const endWord = timeWords[1] ?? '';
  const startWord = timeWords[0] ?? '';
  const explicit24 = (x: string) => /^0\d:/.test(x) || (/^\d{2}:\d{2}$/.test(x) && parseInt(x, 10) >= 13);
  const endExplicit = /am|pm/.test(endWord) || /am|pm/.test(w[w.indexOf(endWord) + 1] ?? '') || explicit24(endWord) || explicit24(startWord);
  if (end <= start && !endExplicit && end.plus({ hours: 12 }) > start && end.hour < 12) end = end.plus({ hours: 12 });
  if (end <= start) end = end.plus({ days: 1 });
  let minutes = end.diff(start, 'minutes').minutes;
  // "minus 30 min break"
  const breakIdx = Math.max(p.idx('minus'), p.idx('-'), p.idx('remove'), p.idx('decrease'));
  if (breakIdx >= 0) {
    for (let i = breakIdx + 1; i + 1 < w.length; i++) {
      if (NUM_RE.test(w[i]) && findUnit(w[i + 1])?.dim === 'time') {
        minutes -= parseFloat(w[i]) * findUnit(w[i + 1])!.factor.toNumber() / 60;
        break;
      }
    }
  }
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes - h * 60);
  const display = m === 0 ? `${h} h` : `${h} h ${m} min`;
  const total = end.diff(start, 'minutes').minutes;
  const spanSteps = [`${start.toFormat('h:mm a')} → ${end.toFormat('h:mm a')}${end.ordinal !== start.ordinal ? ' (next day)' : ''} = ${Math.floor(total / 60)} h ${Math.round(total % 60)} min`];
  if (total !== minutes) spanSteps.push(`minus break ${Math.round(total - minutes)} min = ${h} h ${m} min`);
  return { kind: 'unit', value: new Decimal(minutes).div(60), unit: 'h', steps: spanSteps, display, note: `${start.toFormat('h:mm a')} → ${end.toFormat('h:mm a')}${end.ordinal !== start.ordinal ? ' next day' : ''}` };
}

const MONTH_NAMES = new Set(['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'sept', 'oct', 'nov', 'dec', 'january', 'february', 'march', 'april', 'june', 'july', 'august', 'september', 'october', 'november', 'december']);
const DATE_WORDS = new Set(['today', 'tomorrow', 'yesterday', 'now', 'next', 'last', 'this', 'first', 'end', 'start', 'beginning', 'leap', 'age', 'born', 'weekday', 'weekdays', 'weekends', 'inclusive', 'am', 'pm', 'noon', 'midnight', 'week', 'month', 'year', 'day', 'days', 'weeks', 'months', 'years', 'hours', 'minutes', 'since', 'until', 'till', 'ago', 'old', 'date', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday', 'jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'sept', 'oct', 'nov', 'dec', 'january', 'february', 'march', 'april', 'june', 'july', 'august', 'september', 'october', 'november', 'december']);

function intentDates(p: Parsed, ctx: EvalContext): Quantity | null {
  const w = p.words.filter((x) => x !== ',');
  while (w.length && w[w.length - 1] === 'of') w.pop();
  const text = w.join(' ');
  const toks = tokenize(text).filter((t) => t.type !== 'space');
  const dates: { q: Quantity; start: number; end: number; monthOnly: boolean }[] = [];
  for (let i = 0; i < toks.length; ) {
    const r = tryParseDate(toks, i, ctx.now(), ctx.zone);
    if (r && r.q.kind === 'date') {
      const monthOnly = r.consumed === 2 && toks[i].type === 'word' && toks[i + 1]?.type === 'number' && toks[i + 1].value.length === 4;
      dates.push({ q: r.q, start: i, end: i + r.consumed, monthOnly });
      i += r.consumed;
    } else i++;
  }
  // "days between 1 jan and": an unfinished question
  const lastWord = w[w.length - 1];
  if (['and', 'to', 'from', 'between'].includes(lastWord) && (p.has('days') || p.has('day') || p.has('weeks') || p.has('months'))) throw new CalcError('second date?', 'e.g. days between 1 jan 2026 and 5 jan 2026');
  // "days in 2024" → the length of the year
  const yearOnly = p.nums.length === 1 && /^\d{4}$/.test(w[p.nums[0]]) && w[p.nums[0] - 1] === 'in' && (p.has('days') || p.has('day')) && !p.has('leap') && !w.some((x) => MONTH_NAMES.has(x));
  if (yearOnly) {
    const year = parseInt(w[p.nums[0]], 10);
    const leap = DateTime.fromObject({ year }).isInLeapYear;
    return { kind: 'unit', value: new Decimal(leap ? 366 : 365), unit: 'day', note: `${year}: ${leap ? 'leap year' : 'not a leap year'}` };
  }
  // "days till christmas 2026": an unknown word must not be dropped to form a different question
  if (w.some((x, i) => /^[\p{L}][\p{L}\p{N}_]*$/u.test(x) && !VERBS.has(x) && !CONNECTORS.has(x) && !KEYWORDS.has(x) && !CANON_KEYWORDS.has(x) && !isUnitWord(x) && !isCurrencyWord(x) && !SCALE_WORDS.has(x) && !TIME_UNITS.has(x) && !ctx.variables.has(x) && !DATE_WORDS.has(x) && !(i > 0 && /^\d/.test(w[i - 1]) && isUnitWord(`${w[i - 1]} ${x}`)))) return null;
  // "is 2028 a leap year", "2028 leap year?"
  if (p.has('leap')) {
    const yearWord = w.find((x) => /^\d{4}$/.test(x));
    const year = yearWord ? parseInt(yearWord, 10) : dates[0]?.q.date!.year;
    if (!year) throw new CalcError('which year?', 'e.g. is 2028 a leap year');
    const leap = DateTime.fromObject({ year }).isInLeapYear;
    return { kind: 'number', value: new Decimal(leap ? 366 : 365), display: leap ? `${year}: leap year` : `${year}: not a leap year`, note: `${leap ? 366 : 365} days` };
  }
  if (dates.length === 0) return null;
  // "age if born 15 aug 1990", "how old … born on …"
  if (p.has('age') || p.has('born')) {
    // "age on 23 oct 2026 if born 23 oct 2000": the date after "born" is the birth date, the other one the reference
    const bornTok = toks.findIndex((t) => t.type === 'word' && t.value === 'born');
    const bornEntry = dates.find((d) => d.start > bornTok) ?? dates[0];
    const refEntry = dates.find((d) => d !== bornEntry);
    const born = bornEntry.q.date!.startOf('day');
    const today = (refEntry ? refEntry.q.date! : ctx.now()).startOf('day');
    if (born > today) throw new CalcError('birth date is in the future');
    const diff = today.diff(born, ['years', 'months', 'days']);
    if (p.has('days') || p.has('day')) return { kind: 'unit', value: new Decimal(Math.floor(today.diff(born, 'days').days)), unit: 'day', note: `born ${born.toFormat('d LLL yyyy')}` };
    if (p.has('months')) return { kind: 'unit', value: new Decimal(Math.floor(today.diff(born, 'months').months)), unit: 'month', note: `born ${born.toFormat('d LLL yyyy')}` };
    const years = Math.floor(diff.years);
    return { kind: 'unit', value: new Decimal(years), unit: 'year', display: `${years} years`, note: `${years} years ${Math.floor(diff.months)} months ${Math.floor(diff.days)} days · born ${born.toFormat('d LLL yyyy')}` };
  }
  if (dates.length >= 2) {
    // "today + tomorrow" is not a difference
    if (p.has('+')) return null;
    const a = dates[0].q.date!.startOf('day');
    const b = dates[1].q.date!.startOf('day');
    const span = `${a.toFormat('d LLL yyyy')} → ${b.toFormat('d LLL yyyy')}`;
    if (p.has('weekdays') || p.has('weekends')) return weekdayResult(p, a, b, span);
    const inclusive = p.has('inclusive');
    if (p.has('weeks')) {
      const days = b.diff(a, 'days').days + (inclusive ? 1 : 0);
      return { kind: 'unit', value: new Decimal(days).div(7), unit: 'week', display: `${formatNumber(new Decimal(days).div(7), { maxDecimals: 2 })} weeks`, note: `${span} · ${days} days` };
    }
    if (p.has('months')) {
      const months = b.diff(a, 'months').months;
      return { kind: 'unit', value: new Decimal(months), unit: 'month', display: `${formatNumber(new Decimal(months), { maxDecimals: 2 })} months`, note: span };
    }
    const days = b.diff(a, 'days').days + (inclusive ? 1 : 0);
    return { kind: 'unit', value: new Decimal(days), unit: 'day', note: `${span}${inclusive ? ' inclusive' : ''}` };
  }
  // a month on its own: "days in feb 2028", "weekdays in march 2026"
  if (dates[0].monthOnly) {
    const first = dates[0].q.date!.startOf('month');
    const last = first.endOf('month').startOf('day');
    const span = `${first.toFormat('d LLL yyyy')} → ${last.toFormat('d LLL yyyy')}`;
    if (p.has('weekdays') || p.has('weekends')) return weekdayResult(p, first, last, span);
    // "february 2028 ka last day" / "march er prothom din" before a plain day count
    if ((p.has('last') || p.has('end')) && (p.has('day') || p.has('days'))) return { kind: 'date', value: new Decimal(last.toMillis()), date: last, display: last.toFormat('ccc, d LLL yyyy') };
    if ((p.has('first') || p.has('start')) && (p.has('day') || p.has('days'))) return { kind: 'date', value: new Decimal(first.toMillis()), date: first, display: first.toFormat('ccc, d LLL yyyy') };
    if (p.has('days') || p.has('day')) return { kind: 'unit', value: new Decimal(first.daysInMonth!), unit: 'day', note: first.toFormat('LLLL yyyy') };
  }
  // "what day is 15 aug 2026", "aaj ka din kya hai"
  if (p.has('weekday')) {
    const d = dates[0].q.date!;
    return { ...dates[0].q, display: d.toFormat('cccc, d LLL yyyy') };
  }
  // a bare date phrase ("agle somvar", "pichla saal", "next friday") is simply that date
  if (dates[0].start === 0 && dates[0].end === toks.length) return { ...dates[0].q, display: dates[0].q.date!.toFormat('ccc, d LLL yyyy') };
  let amount: Decimal | null = null;
  let unit: string | null = null;
  // an offset that is part of the date literal ("2 years before" in "2 saal pehle ki date") is not applied again
  const inLiteral = (i: number) => dates.some((d) => i >= d.start && i < d.end);
  for (let i = 0; i < toks.length; i++) {
    if (toks[i].type === 'word' && TIME_UNITS.has(toks[i].value) && i > 0 && toks[i - 1].type === 'number' && !inLiteral(i) && !inLiteral(i - 1)) {
      amount = new Decimal(toks[i - 1].value);
      unit = toks[i].value;
      break;
    }
  }
  if (amount === null || !unit) {
    const d = dates[0].q.date!;
    // "days until end of year": a span to a date phrase
    if ((p.has('days') || p.has('day')) && (p.has('to') || p.has('from')) && dates[0].q.display) {
      const today = ctx.now().startOf('day');
      const since = p.has('from') && !p.has('to') && d.startOf('day') < today;
      const [a, b] = since ? [d.startOf('day'), today] : [today, d.startOf('day')];
      const days = b.diff(a, 'days').days;
      return { kind: 'unit', value: new Decimal(days), unit: 'day', steps: [`${a.toFormat('ccc, d LLL yyyy')} → ${b.toFormat('ccc, d LLL yyyy')}`, `${days} days (the end date is not counted)`], note: `${a.toFormat('d LLL yyyy')} → ${b.toFormat('d LLL yyyy')}` };
    }
    if (dates[0].q.display) return dates[0].q;
    // "days until 25 dec 2026", "25 dec tak kitne din", "how many days to 1 jan 2027" → from today;
    // "days since 1 jan 2026" / "days from 1 jan 2026" → up to today
    if ((p.has('days') || p.has('day')) && (p.has('to') || p.has('between') || p.has('what') || p.has('from')) && !dates[0].q.display) {
      const today = ctx.now().startOf('day');
      const since = p.has('from') && !p.has('to') && dates[0].q.date!.startOf('day') < today;
      const [a, b] = since ? [d.startOf('day'), today] : [today, d.startOf('day')];
      const days = b.diff(a, 'days').days;
      return { kind: 'unit', value: new Decimal(days), unit: 'day', steps: [`${a.toFormat('ccc, d LLL yyyy')} → ${b.toFormat('ccc, d LLL yyyy')}`, `${days} days (the end date is not counted)`], note: `${a.toFormat('d LLL yyyy')} → ${b.toFormat('d LLL yyyy')}` };
    }
    // Hindi order: "february 2028 ka last day", "march ka aakhri din"
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
  const q: Quantity = { kind: 'date', value: new Decimal(shifted.toMillis()), date: shifted, display: shifted.toFormat('ccc, d LLL yyyy'), steps: [`${d.toFormat('ccc, d LLL yyyy')} ${sign > 0 ? '+' : '−'} ${formatNumber(amount)} ${unitKey}`, `= ${shifted.toFormat('ccc, d LLL yyyy')}${unitKey === 'months' || unitKey === 'years' ? ' (a day the month does not have moves to its last day)' : ''}`] };
  if (p.notes.length) q.note = p.notes.join(' · ');
  return q;
}

function intentEmi(p: Parsed, ctx: EvalContext): Quantity | null {
  if (!p.has('emi') && !(p.has('loan') && p.pcts.length > 0) && !(p.has('flat') && p.pcts.length > 0)) return null;
  const used = new Set<number>();
  const months = tenureMonths(p, used);
  if (p.pcts.length === 0) throw new CalcError('rate?', 'e.g. emi 5 lakh at 9% for 5 years');
  if (months === null) throw new CalcError('tenure?', 'add years or months: … for 5 years');
  if (Math.round(months) < 1) throw new CalcError('tenure must be at least 1 month');
  const rate = pctAt(p, p.pcts[0]);
  used.add(p.pcts[0]);
  const principalIdx = p.nums.find((i) => !used.has(i));
  if (principalIdx === undefined) throw new CalcError('loan amount?', 'e.g. emi 5 lakh at 9% for 5 years');
  const { q: principal } = numberAt(p, principalIdx, ctx);
  const n = Math.round(months);
  // flat-rate loans charge interest on the whole principal for the whole term; EMI is reducing-balance
  const flat = p.has('flat');
  const r = flat ? fin.flatRateLoan(principal.value, rate, n) : fin.emi(principal.value, rate, n);
  const method = flat ? 'flat rate' : 'reducing balance';
  const emiQ = moneyOrNumber(r.emi, principal);
  const totalQ = moneyOrNumber(r.totalPayment, principal);
  const interestQ = moneyOrNumber(r.totalInterest, principal);
  const rm = rate.div(1200);
  const fq = (v: Decimal) => formatQuantity(moneyOrNumber(fin.money2(v), principal));
  const steps = flat
    ? [`flat rate: interest = P × r × years = ${fq(principal.value)} × ${formatNumber(rate)}% × ${formatNumber(new Decimal(n).div(12))} = ${fq(r.totalInterest)}`, `total = ${fq(principal.value)} + ${fq(r.totalInterest)} = ${fq(r.totalPayment)}`, `EMI = ${fq(r.totalPayment)} ÷ ${n} = ${fq(r.emi)}`]
    : [
        `monthly rate r = ${formatNumber(rate)}% ÷ 12 = ${formatNumber(rm.mul(100), { maxDecimals: 4 })}%`,
        `months n = ${n}`,
        `EMI = P × r × (1 + r)^n ÷ ((1 + r)^n − 1)`,
        `(1 + r)^n = ${formatNumber(new Decimal(1).plus(rm).pow(n), { maxDecimals: 4 })}`,
        `EMI = ${fq(principal.value)} × ${formatNumber(rm, { maxDecimals: 6 })} × ${formatNumber(new Decimal(1).plus(rm).pow(n), { maxDecimals: 4 })} ÷ ${formatNumber(new Decimal(1).plus(rm).pow(n).minus(1), { maxDecimals: 4 })} = ${fq(r.emi)}`,
        `total paid = ${fq(r.emi)} × ${n} = ${fq(r.totalPayment)}`,
        `interest = ${fq(r.totalPayment)} − ${fq(principal.value)} = ${fq(r.totalInterest)}`,
      ];
  // answer what is asked: total interest, total payment, or the instalment
  if (p.has('interest')) return { ...interestQ, steps, note: `total interest · ${method} · ${n} months · EMI ${formatQuantity(emiQ)} · total ${formatQuantity(totalQ)}` };
  if (p.has('total')) return { ...totalQ, steps, note: `total payment · ${method} · ${n} months · EMI ${formatQuantity(emiQ)} · interest ${formatQuantity(interestQ)}` };
  return {
    ...emiQ,
    steps,
    display: `${formatQuantity(emiQ)}/month`,
    note: `${method} · ${n} months · total ${formatQuantity(totalQ)} · interest ${formatQuantity(interestQ)}`,
  };
}

function intentInterest(p: Parsed, ctx: EvalContext): Quantity | null {
  if (!p.has('interest') && !p.has('compound') && !p.has('simple')) {
    // "10000 at 8% for 3 years, amount?" — the method is not stated: ask rather than pick one
    if (p.has('at') && p.pcts.length === 1 && p.nums.length >= 1 && tenureMonths(p, new Set()) !== null && !p.has('emi') && !p.has('loan') && !p.has('gst') && !p.has('discount')) {
      throw new CalcError('simple or compound interest?', 'e.g. … at 8% simple interest for 3 years');
    }
    return null;
  }
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
  const fq = (v: Decimal) => formatQuantity(moneyOrNumber(fin.money2(v), principal));
  let steps: string[];
  if (kind === 'compound') {
    const per: Record<string, number> = { yearly: 1, 'half-yearly': 2, quarterly: 4, monthly: 12, daily: 365 };
    const k = per[label.replace('compound ', '')] ?? 1;
    const factor = new Decimal(1).plus(rate.div(100).div(k)).pow(years.mul(k));
    steps = [`A = P × (1 + r/${k})^(${k} × t)`, `(1 + ${formatNumber(rate)}%/${k})^(${k} × ${formatNumber(years)}) = ${formatNumber(factor, { maxDecimals: 6 })}`, `A = ${fq(principal.value)} × ${formatNumber(factor, { maxDecimals: 6 })} = ${fq(total)}`, `interest = ${fq(total)} − ${fq(principal.value)} = ${fq(interest)}`];
  } else {
    steps = [`interest = P × r × t`, `= ${fq(principal.value)} × ${formatNumber(rate)}% × ${formatNumber(years)} = ${fq(interest)}`, `amount = ${fq(principal.value)} + ${fq(interest)} = ${fq(total)}`];
  }
  if (wantsTotal) {
    const q = moneyOrNumber(total, principal);
    return { ...q, steps, note: `amount after ${label} · interest ${formatQuantity(moneyOrNumber(interest, principal))} · ${tenure}` };
  }
  const q = moneyOrNumber(interest, principal);
  return { ...q, steps, note: `${label} · total ${formatQuantity(moneyOrNumber(total, principal))} · ${tenure}` };
}

/** "50000 divided equally among 3 people", "50000 ke 3 bhag karo", "50000 ko 3 logon mein divide karo" */
/** "average of 10, 20, 30", "median of 3, 9, 4", "max of 4 and 9", "sum of 1, 2, 3" */
const LIST_FNS = ['average', 'median', 'max', 'min', 'sum', 'total', 'lcm', 'gcd', 'mode'];
const LIST_LABEL: Record<string, string> = { average: 'average', median: 'median', max: 'max', min: 'min', sum: 'sum', total: 'sum', lcm: 'LCM', gcd: 'GCD', mode: 'mode' };

function listValue(fn: string, items: Quantity[], ctx: EvalContext): Quantity {
  const sorted = items.slice().sort((x, y) => x.value.cmp(y.value));
  const like = items[0];
  const n = items.length;
  const sum = items.reduce((acc, q) => acc.plus(q.value), new Decimal(0));
  switch (fn) {
    case 'average':
      return moneyOrNumber(sum.div(n), like);
    case 'median': {
      const mid = Math.floor(n / 2);
      return moneyOrNumber(n % 2 ? sorted[mid].value : sorted[mid - 1].value.plus(sorted[mid].value).div(2), like);
    }
    case 'max':
      return moneyOrNumber(sorted[n - 1].value, like);
    case 'min':
      return moneyOrNumber(sorted[0].value, like);
    case 'lcm':
    case 'gcd':
    case 'mode':
      return evalWords([`${fn}(${items.map((q) => q.value.toString()).join(', ')})`], ctx);
    default:
      return moneyOrNumber(sum, like);
  }
}

/** "average of 10, 20, 30", "lcm of 84 and 126", "least common multiple and greatest common divisor of 84 and 126" */
function intentList(p: Parsed, ctx: EvalContext): Quantity | null {
  const fnWords = LIST_FNS.filter((f) => p.has(f));
  if (!fnWords.length || p.nums.length < 2 || p.pcts.length) return null;
  // everything else must be separators or connectors: a list, nothing more
  const other = p.words.filter((x, i) => !p.nums.includes(i) && !LIST_FNS.includes(x) && !['of', ',', 'and', 'what', 'between', 'the', 'these', 'numbers', 'values'].includes(x) && !isCurrencyWord(x) && !isUnitWord(x) && !SCALE_WORDS.has(x));
  if (other.length) return null;
  // "average speed 120 km in 1.5 hours" is not a list: only separators and units may sit between the numbers
  for (let k = 1; k < p.nums.length; k++) {
    const between = p.words.slice(p.nums[k - 1] + 1, p.nums[k]);
    if (!between.every((w) => w === ',' || w === 'and' || isCurrencyWord(w) || isUnitWord(w) || SCALE_WORDS.has(w))) return null;
  }
  const items = p.nums.map((i) => numberAt(p, i, ctx).q);
  const list = items.map((q) => formatQuantity(q)).join(', ');
  const results = fnWords.map((f) => ({ f, q: listValue(f, items, ctx) }));
  if (results.length === 1) return { ...results[0].q, note: `${LIST_LABEL[results[0].f]} of ${list}` };
  return { ...results[0].q, display: results.map((r) => `${LIST_LABEL[r.f]} ${formatQuantity(r.q)}`).join(' · '), note: `of ${list}` };
}

/** "divide 700 in the ratio 3:4", "3:4 ratio of 700", "700 ko 3:4 me baanto" → shares */
function simplifyRatio(parts: Decimal[]): Quantity {
  if (!parts.every((x) => x.isInteger())) throw new CalcError('ratio parts must be whole numbers');
  const gcd2 = (x: Decimal, y: Decimal): Decimal => (y.isZero() ? x : gcd2(y, x.mod(y)));
  const g = parts.reduce((acc, x) => gcd2(acc, x));
  if (g.isZero()) throw new CalcError('ratio parts add up to 0');
  const simple = parts.map((x) => x.div(g));
  const text = simple.map((x) => x.toString()).join(':');
  const orig = parts.map((x) => x.toString()).join(':');
  return { kind: 'number', value: simple[0], display: text, note: text === orig ? 'simplest form' : `${orig} simplified` };
}

function intentRatio(p: Parsed, ctx: EvalContext): Quantity | null {
  const raw = p.words.join(' ');
  const hasWord = p.has('ratio') || p.has('divide');
  const m = /(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)(?:\s*:\s*(\d+(?:\.\d+)?))?/.exec(raw);
  let parts: Decimal[];
  if (m) {
    const colonTok = p.words.findIndex((w) => /^\d+(?:\.\d+)?:\d/.test(w));
    // "2:3 of 500" needs no ratio word; "5:30 to 6:45" is a time span, not a ratio
    if (!hasWord && !(colonTok >= 0 && p.words[colonTok + 1] === 'of')) return null;
    parts = [m[1], m[2], m[3]].filter(Boolean).map((x) => new Decimal(x!));
  } else if (p.has('ratio') && p.nums.length === 2 && p.pcts.length === 0 && p.words[p.nums[0] + 1] === 'to' && p.nums[1] === p.nums[0] + 2) {
    // "ratio of 3 to 4"
    parts = [new Decimal(p.words[p.nums[0]]), new Decimal(p.words[p.nums[1]])];
    return simplifyRatio(parts);
  } else return null;
  const sum = parts.reduce((acc, x) => acc.plus(x), new Decimal(0));
  if (sum.isZero()) throw new CalcError('ratio parts add up to 0');
  // the total is the number that is not part of the ratio
  const ratioTokens = new Set(parts.map((x) => x.toString()));
  const totalIdx = p.nums.find((i) => !ratioTokens.has(p.words[i].replace(/[^\d.]/g, '')) || p.words[i - 1] === 'of' || p.words[i + 1] === 'of');
  if (totalIdx === undefined) {
    if (!p.has('ratio') || p.has('divide')) throw new CalcError('total to divide?', 'e.g. divide 700 in ratio 3:4');
    // "ratio 300:400" / "simplify ratio 300:400" → 3:4
    return simplifyRatio(parts);
  }
  const { q: total } = numberAt(p, totalIdx, ctx);
  const shares = parts.map((x) => moneyOrNumber(total.value.mul(x).div(sum), total));
  return { ...total, display: shares.map((sh) => formatQuantity(sh)).join(' / '), note: `${formatQuantity(total)} in ratio ${parts.map((x) => x.toString()).join(':')}` };
}

/** "3 items at ₹120 each", "5 pcs @ 24.75 each" → quantity × unit price */
function intentQuantity(p: Parsed, ctx: EvalContext): Quantity | null {
  if (!(p.has('each') || p.has('items')) || p.nums.length !== 2 || p.pcts.length > 1) return null;
  if (p.has('divide') || p.has('parts') || p.has('equally') || p.has('people')) return null;
  const countIdx = p.nums.find((i) => p.words[i + 1] === 'items' || p.words[i - 1] === 'items') ?? p.nums[0];
  const priceIdx = p.nums.find((i) => i !== countIdx)!;
  const count = new Decimal(p.words[countIdx].replace(/[^\d.]/g, ''));
  const { q: price } = numberAt(p, priceIdx, ctx);
  const subtotal = moneyOrNumber(price.value.mul(count), price);
  const note = `${formatNumber(count)} × ${formatQuantity(price)}`;
  if (p.pcts.length === 1) {
    // "3 items at 250 each with 5% gst" / "… 10% discount"
    const pct = pctAt(p, p.pcts[0]);
    if (p.has('gst')) {
      const r = fin.gstAdd(subtotal.value, pct);
      return { ...moneyOrNumber(r.total, subtotal), note: `${note} = ${formatQuantity(subtotal)} · GST ${formatQuantity(moneyOrNumber(r.tax, subtotal))} @ ${formatNumber(pct)}%` };
    }
    if (p.has('discount') || p.has('off')) {
      const r = fin.discount(subtotal.value, pct);
      return { ...moneyOrNumber(r.final, subtotal), note: `${note} = ${formatQuantity(subtotal)} · discount ${formatQuantity(moneyOrNumber(r.saved, subtotal))} @ ${formatNumber(pct)}%` };
    }
    return null;
  }
  return { ...subtotal, note };
}

function intentDivide(p: Parsed, ctx: EvalContext): Quantity | null {
  const marker = p.has('divide') || p.has('parts') || p.has('equally') || p.has('people');
  if (!marker) return null;
  if (p.nums.length === 1 && p.pcts.length === 0 && !p.words.some((w) => /\d:\d/.test(w))) throw new CalcError('divide among how many?', 'e.g. split 1000 among 4 people');
  if (p.nums.length < 2) return null;
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
  let { q: amount } = numberAt(p, amountIdx, ctx);
  // "bill 1200 + 15% tip split 4 ways": the amount is the whole expression before splitting
  if (p.pcts.length === 1) {
    const pct = pctAt(p, p.pcts[0]);
    const hasOp = p.words.some((w) => ['+', '-', 'add', 'remove', 'decrease', 'discount', 'off', 'with', 'inclusive'].includes(w));
    if (hasOp) {
      const minus = p.words.some((w) => ['-', 'remove', 'decrease', 'discount', 'off'].includes(w));
      amount = moneyOrNumber(amount.value.mul(new Decimal(100).plus(pct.mul(minus ? -1 : 1))).div(100), amount);
    }
  }
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
/** revenue − COGS = gross profit; − operating expenses = operating profit; margins on revenue */
function businessWithCogs(p: Parsed, ctx: EvalContext): Quantity {
  const used = new Set<number>();
  const revIdx = p.has('revenue') ? numberNear(p, p.idx('revenue'), used) : p.has('sell') ? numberNear(p, p.idx('sell'), used) : undefined;
  if (revIdx === undefined) throw new CalcError('revenue amount?', 'e.g. revenue 2500000, cogs 1450000');
  used.add(revIdx);
  const { q: revenue } = numberAt(p, revIdx, ctx);
  const cogsIdx = numberNear(p, p.idx('cogs'), used);
  if (cogsIdx === undefined) throw new CalcError('cost of goods sold amount?', 'e.g. revenue 2500000, cogs 1450000');
  used.add(cogsIdx);
  const { q: cogs } = numberAt(p, cogsIdx, ctx);
  let opex = new Decimal(0);
  for (const m of p.words.map((w, i) => (w === 'expenses' ? i : -1)).filter((i) => i >= 0)) {
    const i = numberNear(p, m, used);
    if (i !== undefined) {
      used.add(i);
      opex = opex.plus(numberAt(p, i, ctx).q.value);
    }
  }
  const money = (v: Decimal) => formatQuantity(moneyOrNumber(v, revenue));
  const gross = revenue.value.minus(cogs.value);
  const op = gross.minus(opex);
  const pctOf = (v: Decimal) => (revenue.value.isZero() ? new Decimal(NaN) : fin.pct2(v.div(revenue.value).mul(100)));
  const grossMargin = pctOf(gross);
  const opMargin = pctOf(op);
  const note = `gross profit ${money(gross)} (${formatNumber(grossMargin)}%) · operating expenses ${money(opex)} · operating profit ${money(op)} · operating margin ${formatNumber(opMargin)}% · revenue ${money(revenue.value)} · COGS ${money(cogs.value)}`;
  if (p.has('margin') || p.has('%') || p.has('markup')) {
    const gross1 = p.has('gross');
    return { kind: 'percent', value: gross1 ? grossMargin : opMargin, display: `${formatNumber(gross1 ? grossMargin : opMargin)}% ${gross1 ? 'gross' : 'operating'} margin`, note };
  }
  if (opex.isZero()) return { ...moneyOrNumber(gross.abs(), revenue), display: `${money(gross.abs())} gross ${gross.isNegative() ? 'loss' : 'profit'}`, note };
  return { ...moneyOrNumber(op.abs(), revenue), display: `${money(op.abs())} operating ${op.isNegative() ? 'loss' : 'profit'}`, note };
}

function intentBusiness(p: Parsed, ctx: EvalContext): Quantity | null {
  if (p.has('cogs') && (p.has('revenue') || p.has('sell'))) return businessWithCogs(p, ctx);
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
    used.add(expIdx);
    // several expense lines ("cogs 600 opex 200") add up
    for (const m of p.words.map((w, i) => (w === 'expenses' ? i : -1)).filter((i) => i >= 0 && i !== expMarker)) {
      const extra = numberNear(p, m, used);
      if (extra !== undefined) {
        used.add(extra);
        expenses = moneyOrNumber(expenses.value.plus(numberAt(p, extra, ctx).q.value), expenses);
      }
    }
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
  const hasSell = p.has('sell') || (p.has('received') && (p.has('cost') || p.has('return')));
  const hasReturn = p.has('return');
  const hasPL = p.has('profit') || p.has('loss') || hasReturn;
  if (!hasCost && !hasSell && !hasPL) return null;
  // "cost" on its own ("5 items cost 24.75 each") is a price, not a trade: never pair it with a guessed selling price
  if (!hasSell && !hasPL) return null;
  if (p.has('margin') || p.has('markup')) return null;
  const used = new Set<number>();
  if (hasPL && p.pcts.length === 1 && p.nums.length === 1) {
    const pct = pctAt(p, p.pcts[0]);
    const { q: given } = numberAt(p, p.nums[0], ctx);
    const sign = p.has('loss') ? -1 : 1;
    // which side is the given number? next to "sell" (or "sold at") → the cost is asked; else the selling price is asked
    const sellIdx = p.idx('sell');
    // "sell at 20% profit on 450": the amount after "on" is the cost, however early "sell" appears;
    // "sold at 25% loss for 600, cost": "cost" at the end is the question, "for 600" is the sale
    const prev = p.words[p.nums[0] - 1];
    const afterOn = prev === 'on' || prev === 'cost';
    const costAsksQuestion = hasCost && p.idx('cost') === p.words.length - 1 && p.nums[0] < p.idx('cost');
    const givenIsSell = hasSell && !afterOn && (costAsksQuestion || prev === 'for' || (!hasCost ? Math.abs(sellIdx - p.nums[0]) <= 2 : Math.abs(sellIdx - p.nums[0]) < Math.abs(p.idx('cost') - p.nums[0])));
    if (givenIsSell) {
      const factor = new Decimal(100).plus(pct.mul(sign));
      if (factor.lte(0)) throw new CalcError('loss must be below 100%');
      const cost = given.value.div(factor).mul(100);
      const shown = moneyOrNumber(fin.money2(cost), given);
      return { ...moneyOrNumber(cost, given), display: formatQuantity(shown), note: `cost price · ${p.has('loss') ? 'loss' : 'profit'} ${formatQuantity(moneyOrNumber(given.value.minus(cost).abs().toDecimalPlaces(2), given))} on sale at ${formatQuantity(given)}` };
    }
    const price = fin.money2(given.value.mul(new Decimal(100).plus(pct.mul(sign))).div(100));
    const q = moneyOrNumber(price, given);
    return { ...q, note: `${p.has('loss') ? 'loss' : 'profit'} ${formatQuantity(moneyOrNumber(price.minus(given.value).abs(), given))} on cost ${formatQuantity(given)}` };
  }
  if (p.nums.length < 2) {
    if (hasPL && p.nums.length === 1) throw new CalcError('selling price?', 'e.g. bought at 500 sold at 600');
    if (hasSell && !hasCost && p.nums.length === 1 && p.pcts.length === 0) throw new CalcError('cost price?', 'e.g. bought at 500 sold at 600');
    return null;
  }
  // "profit of 150 on cost 600, profit %": the amount next to profit/loss over the cost (or the sale)
  const plWord = p.has('profit') ? 'profit' : p.has('loss') ? 'loss' : null;
  if (plWord && p.pcts.length === 0 && (hasCost || hasSell)) {
    const pi = p.idx(plWord);
    const amtIdx = p.nums.find((i) => i === pi + 1 || (i === pi + 2 && p.words[pi + 1] === 'of'));
    const baseMarker = hasCost ? p.idx('cost') : p.idx('sell');
    const baseIdx = amtIdx !== undefined ? numberNear(p, baseMarker, new Set([amtIdx])) : undefined;
    if (amtIdx !== undefined && baseIdx !== undefined && baseIdx !== amtIdx) {
      const { q: amt } = numberAt(p, amtIdx, ctx);
      const { q: base } = numberAt(p, baseIdx, ctx);
      const cost = hasCost ? base.value : plWord === 'profit' ? base.value.minus(amt.value) : base.value.plus(amt.value);
      if (cost.lte(0)) throw new CalcError('cost must be positive');
      const pct = fin.pct2(amt.value.div(cost).mul(100));
      return { kind: 'percent', value: pct, note: `${plWord} ${formatQuantity(amt)} on cost ${formatQuantity(moneyOrNumber(cost, base))}` };
    }
  }
  let costIdx: number | undefined;
  let sellIdx: number | undefined;
  // "bought 10 pens at 12 each, sold all at 15 each": the unit prices are the numbers before "each"
  if (p.has('each')) {
    const eachNums = p.nums.filter((i) => p.words[i + 1] === 'each');
    if (eachNums.length === 2) {
      if (hasCost && hasSell) [costIdx, sellIdx] = p.idx('cost') < p.idx('sell') ? eachNums : [eachNums[1], eachNums[0]];
      else [costIdx, sellIdx] = eachNums;
      used.add(costIdx!).add(sellIdx!);
    }
  }
  if (hasCost && costIdx === undefined) {
    costIdx = numberNear(p, p.idx('cost'), used);
    if (costIdx !== undefined) used.add(costIdx);
  }
  if (hasSell && sellIdx === undefined) {
    sellIdx = numberNear(p, p.has('sell') ? p.idx('sell') : p.idx('received'), used);
    if (sellIdx !== undefined) used.add(sellIdx);
  }
  const free = p.nums.filter((i) => !used.has(i));
  if (costIdx === undefined) costIdx = free.shift();
  if (sellIdx === undefined) sellIdx = free.shift();
  if (costIdx === undefined || sellIdx === undefined) throw new CalcError('cost and selling price?', 'e.g. cost 500 sold 600');
  const { q: cost } = numberAt(p, costIdx, ctx);
  const { q: sell } = numberAt(p, sellIdx, ctx);
  // "bought 10 pens at 12 each, sold all at 15 each": the count multiplies both sides
  let r = fin.profitLoss(cost.value, sell.value);
  if (p.has('each')) {
    const countIdx = p.nums.find((i) => !used.has(i) && i !== costIdx && i !== sellIdx && i < costIdx);
    if (countIdx !== undefined) {
      const count = new Decimal(p.words[countIdx].replace(/[^\d.]/g, ''));
      r = fin.profitLoss(cost.value.mul(count), sell.value.mul(count));
    }
  }
  const q = moneyOrNumber(r.amount.abs(), cost);
  const label = r.amount.isNegative() ? 'loss' : 'profit';
  // "invested 5000, got back 6500, return?" → the percentage is the answer, the gain is the note
  if (hasReturn) return { kind: 'percent', value: r.pct, display: `${formatNumber(r.pct)}% return`, note: `${label} ${formatQuantity(q)} · invested ${formatQuantity(cost)} → ${formatQuantity(sell)}` };
  // "cp 800 sp 1000 profit percent": the percentage is the answer
  if (p.has('%')) return { kind: 'percent', value: r.pct, display: `${formatNumber(r.pct.abs())}%`, note: `${label} ${formatQuantity(q)} on cost ${formatQuantity(cost)} → sold ${formatQuantity(sell)}` };
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
  // "3 items at 250 each with 5% gst" is a quantity line (handled by intentQuantity)
  if ((p.has('each') || p.has('items')) && p.nums.length >= 2) return null;
  if (p.pcts.length === 0) throw new CalcError('GST rate?', 'e.g. 25000 + 18% GST (rates: 5, 12, 18, 28, 40)');
  // every percentage next to a tax word is a tax on the same base: "5% GST + 2% cess", "9% CGST + 9% SGST"
  const taxIdx = p.words.map((w, i) => (w === 'gst' ? i : -1)).filter((i) => i >= 0);
  const taxPcts = p.pcts.filter((i) => !['decrease', 'remove', 'discount', 'off'].includes(p.words[i + 1]) && taxIdx.some((t) => Math.abs(t - i) <= 2 && !p.words.slice(Math.min(t, i) + 1, Math.max(t, i)).some((w) => [',', 'then', 'discount', 'off', 'before'].includes(w))));
  // "1000 + 18% gst then 2% tds": other steps belong to the chain; never answer only the tax part
  if ((p.has('then') || p.has(',')) && p.pcts.length >= 2 && p.pcts.some((i) => !taxPcts.includes(i))) return null;
  const ratePcts = taxPcts.length ? taxPcts : [p.pcts[0]];
  const rate = ratePcts.reduce((s, i) => s.plus(pctAt(p, i)), new Decimal(0));
  const rateText = ratePcts.length > 1 ? `${ratePcts.map((i) => formatNumber(pctAt(p, i)) + '%').join(' + ')} = ${formatNumber(rate)}%` : `${formatNumber(rate)}%`;
  const used = new Set<number>(ratePcts);
  const base = remainingBase(p, used, ctx);
  const gstIdx = p.idx('gst');
  const addMode = p.has('add') || p.has('with') || p.has('on') || p.has('increase') || p.has('+') || p.has('plus');
  // "1000 me 18% GST hai / ache" — the amount already contains GST
  const containsGst = p.nums.length >= 1 && !addMode && ((p.nums[0] < gstIdx && p.words.slice(p.nums[0], gstIdx).includes('in')) || (gstIdx < p.nums[0] && p.words[p.nums[0] - 1] === 'in'));
  // "how much gst in 2360 at 18%", "gst amount on 5000 at 12%": the tax itself is the answer
  const wantsTax = p.has('what') && taxIdx.some((t) => Math.abs(p.idx('what') - t) === 1);
  // "30% tax katke", "12% tds on 50000": a deduction, not GST removal
  const deduct = !p.has('inclusive') && p.pcts.some((i) => p.words[i + 1] === 'decrease' || p.words[i - 1] === 'decrease' || p.words[i + 2] === 'decrease');
  if (deduct) {
    const net = base.value.mul(new Decimal(100).minus(rate)).div(100);
    return { ...moneyOrNumber(net, base), note: `tax ${formatQuantity(moneyOrNumber(base.value.mul(rate).div(100), base))} deducted @ ${rateText} · from ${formatQuantity(base)}` };
  }
  const reverse = p.has('remove') || p.has('reverse') || p.has('inclusive') || p.has('without') || p.has('-') || (p.has('base') && !ctx.variables.has('base')) || p.has('minus') || containsGst || (p.has('from') && !addMode);
  const gq = (v: Decimal) => formatQuantity(moneyOrNumber(fin.money2(v), base));
  if (reverse) {
    const r = fin.gstRemove(base.value, rate);
    // the stored value keeps full precision (later "10% of that" uses it); the display is the rounded money amount
    const exact = base.value.div(new Decimal(1).plus(rate.div(100)));
    const steps = [`price before GST = total ÷ (1 + ${formatNumber(rate)}%)`, `= ${gq(base.value)} ÷ ${formatNumber(new Decimal(1).plus(rate.div(100)), { maxDecimals: 4 })} = ${gq(r.base)}`, `GST = ${gq(base.value)} − ${gq(r.base)} = ${gq(r.tax)}`];
    if (wantsTax) return { ...moneyOrNumber(r.tax, base), steps, note: `GST @ ${rateText} · before GST ${formatQuantity(moneyOrNumber(r.base, base))} · total ${formatQuantity(base)}` };
    return { ...moneyOrNumber(exact, base), steps, display: formatQuantity(moneyOrNumber(r.base, base)), note: `before GST · GST ${formatQuantity(moneyOrNumber(r.tax, base))} · total ${formatQuantity(base)} @ ${rateText}` };
  }
  const r = fin.gstAdd(base.value, rate);
  const steps = [`GST = ${gq(base.value)} × ${rateText} = ${gq(r.tax)}`, `total = ${gq(base.value)} + ${gq(r.tax)} = ${gq(r.total)}`];
  if (wantsTax) return { ...moneyOrNumber(r.tax, base), steps, note: `GST @ ${rateText} · total ${formatQuantity(moneyOrNumber(r.total, base))}` };
  if (addMode) return { ...moneyOrNumber(r.total, base), steps, note: `incl. GST ${formatQuantity(moneyOrNumber(r.tax, base))} @ ${rateText}` };
  return { ...moneyOrNumber(r.tax, base), steps, note: `GST @ ${rateText} · total ${formatQuantity(moneyOrNumber(r.total, base))}` };
}

function intentDiscount(p: Parsed, ctx: EvalContext): Quantity | null {
  if (!p.has('discount')) return null;
  // "1200 after 20% discount, original price?": a reverse question, answered by the percent rules
  if (p.has('what') && p.pcts.length === 1 && p.nums.length === 1) {
    const afterIdx = p.lastIdx('after');
    if (p.has('than') || (afterIdx >= 0 && !['on', 'of'].includes(p.words[p.nums[0] - 1]))) return null;
  }
  if (p.pcts.length === 0) {
    if (p.nums.length >= 2) {
      const { q: a } = numberAt(p, p.nums[0], ctx);
      const { q: b } = numberAt(p, p.nums[1], ctx);
      // "discount of 150 on 1000": the amount next to "discount" over the base
      const dIdx = p.idx('discount');
      const amtIdx = p.nums.find((i) => i === dIdx + 1 || (i === dIdx + 2 && p.words[dIdx + 1] === 'of'));
      if (amtIdx !== undefined) {
        const amt = amtIdx === p.nums[0] ? a : b;
        const base = amtIdx === p.nums[0] ? b : a;
        if (base.value.isZero()) throw new CalcError('division by zero');
        return { kind: 'percent', value: fin.pct2(amt.value.div(base.value).mul(100)), note: `discount ${formatQuantity(amt)} on ${formatQuantity(base)}` };
      }
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
  // "68000 7% increase, then 10% decrease" is a chain; one step at a time here
  if (p.pcts.length > 1 || p.has('then') || p.has(',')) return null;
  // "plus"/"minus" are infix operators for the parser ("10 squared minus 5 squared"), not instructions
  const incIdx = Math.max(p.lastIdx('increase'), p.lastIdx('add'));
  const decIdx = Math.max(p.lastIdx('decrease'), p.lastIdx('remove'));
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
  // "20% of what is 30", "10 is 20% of what (number)": the percentage, "of"/"on"/"off" and "what" sit together.
  // "5000 ka 18% kitna" (X of P% what) and "2500 taka 5% koto" (X P% what) are plain percent-of questions instead.
  const numberAfterWhat = wi >= 0 && p.nums.some((i) => i > wi);
  const adjacentWhat =
    p.pcts.length === 1 && p.nums.length === 1 && ((w[p.pcts[0] + 1] === 'what' && numberAfterWhat) || (['of', 'on', 'off'].includes(w[p.pcts[0] + 1]) && w[p.pcts[0] + 2] === 'what'));
  if (adjacentWhat && wi >= 0 && p.nums.length === 1 && !p.has('than')) {
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
  // percentage points: "20% + 5 points", "5 points more than 20%" → plain addition of the two percentages
  if (p.has('points') && p.pcts.length === 2) {
    const [x, y] = [pctAt(p, p.pcts[0]), pctAt(p, p.pcts[1])];
    const pointsIdx = p.idx('points');
    const delta = Math.abs(pointsIdx - p.pcts[0]) <= 1 ? x : y;
    const base = delta === x ? y : x;
    const sign = p.has('decrease') || p.has('-') || p.has('remove') ? -1 : 1;
    const v = base.plus(delta.mul(sign));
    return { kind: 'percent', value: v, note: `${formatNumber(base)}% ${sign < 0 ? '−' : '+'} ${formatNumber(delta)} percentage points` };
  }
  // "percentage difference between 40 and 50" is symmetric (relative to the mean), unlike an increase
  if (p.has('difference') && p.nums.length === 2 && (bare >= 0 || wi >= 0 || p.has('%'))) {
    const { q: a } = numberAt(p, p.nums[0], ctx);
    const { q: b } = numberAt(p, p.nums[1], ctx);
    const pct = fin.percentDifference(a.value, b.value);
    if (pct.isNaN()) throw new CalcError('division by zero', 'both values are 0');
    const inc = a.value.isZero() ? null : fin.percentChange(a.value, b.value);
    return { kind: 'percent', value: pct, display: `${formatNumber(pct)}% difference`, note: `relative to the average of ${formatQuantity(a)} and ${formatQuantity(b)}${inc ? ` · ${formatQuantity(a)} → ${formatQuantity(b)} is a ${formatNumber(inc.abs())}% ${inc.isNegative() ? 'decrease' : 'increase'}` : ''}` };
  }
  const changeWords = p.has('change') || p.has('increase') || p.has('decrease') || p.has('growth');
  if (p.nums.length === 2 && (bare >= 0 || (wi >= 0 && (changeWords || p.has('of'))) || (changeWords && p.has('from') && p.has('to')))) {
    let { q: a } = numberAt(p, p.nums[0], ctx);
    let { q: b } = numberAt(p, p.nums[1], ctx);
    // "40 is what % more than 32": the base is the number after "than"
    if (p.has('than') && p.idx('than') < p.nums[1] && p.idx('than') > p.nums[0]) [a, b] = [b, a];
    const av = a.kind === 'money' && b.kind === 'money' && a.currency !== b.currency ? convertMoney(a, b.currency!, ctx).value : a.value;
    if (changeWords || p.has('from') || p.has('to') || p.has('than')) {
      if (av.isZero()) throw new CalcError('division by zero', 'the starting value is 0');
      const pct = fin.percentChange(av, b.value);
      const word = pct.isNegative() ? 'decrease' : 'increase';
      return { kind: 'percent', value: pct.abs(), display: `${formatNumber(pct.abs())}% ${word}`, note: `${formatQuantity(a)} → ${formatQuantity(b)} (${pct.isNegative() ? '−' : '+'}${formatQuantity(moneyOrNumber(b.value.minus(av).abs(), b))})` };
    }
    const ofIdx = p.idx('of');
    let part = av;
    let whole = b.value;
    const ofBetween = p.words.slice(p.nums[0] + 1, p.nums[1]).includes('of');
    if (!ofBetween && ofIdx >= 0 && ofIdx < p.nums[0]) {
      part = b.value;
      whole = av;
    }
    if (whole.isZero()) throw new CalcError('division by zero');
    return { kind: 'percent', value: fin.pct2(part.div(whole).mul(100)) };
  }
  // "reverse 18% on 1180" → the amount before an 18% increase: 1180 / 1.18
  if (p.has('reverse') && p.nums.length === 1 && p.pcts.length === 1 && !p.has('gst')) {
    const pct = pctAt(p, p.pcts[0]);
    const { q: x } = numberAt(p, p.nums[0], ctx);
    const original = x.value.div(new Decimal(100).plus(pct)).mul(100);
    return { ...moneyOrNumber(original, x), display: formatQuantity(moneyOrNumber(original.toDecimalPlaces(2, Decimal.ROUND_HALF_UP), x)), note: `${formatQuantity(x)} ÷ (1 + ${formatNumber(pct)}%)` };
  }
  // "what is 15% less than 575" / "what is 20% more than 400": the stated number is the base
  const decWord = p.has('decrease') || p.has('discount') || p.has('off');
  const incWord = p.has('increase');
  if (p.nums.length === 1 && p.pcts.length === 1 && p.has('than') && wi >= 0 && p.nums[0] > p.idx('than') && (incWord || decWord)) {
    const pct = pctAt(p, p.pcts[0]);
    const { q: x } = numberAt(p, p.nums[0], ctx);
    const dec = decWord;
    const v = x.value.mul(new Decimal(100).plus(dec ? pct.neg() : pct)).div(100);
    return { ...moneyOrNumber(v, x), note: `${formatNumber(pct)}% ${dec ? 'less' : 'more'} than ${formatQuantity(x)}` };
  }
  // reverse percentage: "840 is 12% less than what original amount" → 840 / 0.88; "750 is 20% more than what number" → 750 / 1.2;
  // "what original amount becomes 3910 after a 15% increase" → 3910 / 1.15
  // ("1200 after 20% discount, original?" and Hindi "20% discount ke baad 800": the number is the outcome;
  //  "what is the price after 20% discount on 1500" puts both after "after" and is a plain discount)
  const afterIdx = p.lastIdx('after');
  const outcomeAfter = afterIdx < 0 || !['on', 'of'].includes(w[p.nums[0] - 1]);
  if (p.nums.length === 1 && p.pcts.length === 1 && (p.has('than') || p.has('from') || p.has('after') || p.has('before')) && wi >= 0 && (!p.has('than') || p.nums[0] < p.idx('than')) && outcomeAfter && (incWord || decWord)) {
    const pct = pctAt(p, p.pcts[0]);
    const { q: x } = numberAt(p, p.nums[0], ctx);
    const factor = decWord ? new Decimal(100).minus(pct) : new Decimal(100).plus(pct);
    if (factor.lte(0)) throw new CalcError('percentage must be below 100%');
    const original = x.value.div(factor).mul(100);
    const shown = moneyOrNumber(original.toDecimalPlaces(2, Decimal.ROUND_HALF_UP), x);
    return { ...moneyOrNumber(original, x), display: formatQuantity(shown), note: `${formatQuantity(x)} is ${formatNumber(pct)}% ${decWord ? 'less' : 'more'} than ${formatQuantity(shown)}` };
  }
  // "2500 rupaye 5%", "2500 ka 5 percent nikalo", "2500 pe 5% kitna": one amount, one percent, no operation word → percent of
  // ("X on P% what" is the Hindi "X pe P% kitna" question; the English form "5% on 30" keeps the percentage first and adds)
  const questionOn = wi >= 0 && p.nums[0] < p.pcts[0] && w.every((x) => x !== 'on' || true);
  if (p.nums.length === 1 && p.pcts.length === 1 && !w.some((x) => OPERATION_WORDS.has(x) && !(x === 'on' && questionOn))) {
    const pct = pctAt(p, p.pcts[0]);
    const { q: x } = numberAt(p, p.nums[0], ctx);
    return { ...moneyOrNumber(x.value.mul(pct).div(100), x), note: `${formatNumber(pct)}% of ${formatQuantity(x)}` };
  }
  return null;
}

/** "100 dollar rupee in" / "5 km miles in" → conversion when exactly one amount and a spare unit/currency word */
function intentConvert(p: Parsed, ctx: EvalContext): Quantity | null {
  if (p.nums.length !== 1) return null;
  if (p.words.some((x, i) => /^[\p{L}][\p{L}\p{N}_]*$/u.test(x) && !VERBS.has(x) && !CONNECTORS.has(x) && !KEYWORDS.has(x) && !isUnitWord(x) && !isCurrencyWord(x) && !SCALE_WORDS.has(x) && !TIME_UNITS.has(x) && !ctx.variables.has(x) && !(i > 0 && isUnitWord(`${p.words[i - 1]} ${x}`)) && !(i + 1 < p.words.length && isUnitWord(`${x} ${p.words[i + 1]}`)))) return null;
  let { q } = numberAt(p, p.nums[0], ctx);
  const { used } = numberAt(p, p.nums[0], ctx);
  // "how many minutes in 3.5 hours": a time unit right after the amount belongs to it
  const after = Math.max(...used) + 1;
  if (q.kind === 'number' && p.words[after] && TIME_UNITS.has(p.words[after])) {
    q = evalWords([q.value.toString(), p.words[after]], ctx);
    used.add(after);
  }
  let targets = p.words.map((w, i) => ({ w, i })).filter(({ w, i }) => !used.has(i) && (isCurrencyWord(w) || isUnitWord(w) || currencyBySymbol(w)));
  for (let k = 0; k < p.words.length; k++) {
    for (const len of [3, 2]) {
      const phrase = p.words.slice(k, k + len).join(' ');
      if (k + len <= p.words.length && !used.has(k) && isUnitWord(phrase) && !isUnitWord(p.words[k]) === false ? false : k + len <= p.words.length && !used.has(k) && isUnitWord(phrase)) {
        targets = [{ w: phrase, i: k }];
        k += len - 1;
        break;
      }
    }
    if (targets.length === 1 && targets[0].w.includes(' ')) break;
  }
  if (targets.length !== 1) {
    const rest = p.words.filter((w, i) => !used.has(i) && !VERBS.has(w) && !CONNECTORS.has(w)).join(' ');
    if (!rest && p.has('convert')) throw new CalcError('convert to what?', 'e.g. 5 kg in lbs, 100 usd in inr');
    if (!rest || !(isUnitWord(rest) || findCurrency(rest))) return null;
    return evalWords([q.kind === 'money' ? `${q.value.toString()} ${q.currency}` : q.kind === 'unit' ? `${q.value.toString()} ${q.unit}` : q.value.toString(), 'in', rest], ctx);
  }
  const target = targets[0].w;
  if (q.kind === 'number' && isUnitWord(target) && !findCurrency(target)) return null;
  const src = q.kind === 'money' ? `${q.value.toString()} ${q.currency}` : q.kind === 'unit' ? `${q.value.toString()} ${q.unit}` : q.value.toString();
  return evalWords([src, 'in', target], ctx);
}

/** a sub-sentence as a value: the parser first, then the intents ("25000 add 18% gst after 10% discount") */
function evaluateWords(words: string[], ctx: EvalContext): Quantity {
  try {
    return evalWords(words, ctx);
  } catch (e) {
    if (!(e instanceof CalcError)) throw e;
    const r = runIntentWords(words, [], ctx);
    if (!r) throw e;
    return r;
  }
}

/** "customer owes 87500 and pays 65% of the balance" / "owes 25000 plus 18% GST after a 10% discount and pays 15000" */
function intentOwes(p: Parsed, ctx: EvalContext): Quantity | null {
  if (!p.has('owes') || !p.has('pays')) return null;
  const oi = p.idx('owes');
  const pi = p.idx('pays');
  if (pi < oi) return null;
  const before = p.words.slice(oi + 1, pi).filter((w, k, arr) => !((w === 'and' || w === ',') && k === arr.length - 1));
  const after = p.words.slice(pi + 1).filter((w) => w !== 'remaining' && w !== 'of');
  if (!before.length) throw new CalcError('amount owed?', 'e.g. owes 25000, pays 15000');
  const invoice = evaluateWords(before, ctx);
  const ap = analyse(after, []);
  let paid: Quantity;
  let how = '';
  if (ap.pcts.length === 1 && ap.nums.length === 0) {
    const pct = pctAt(ap, ap.pcts[0]);
    paid = moneyOrNumber(invoice.value.mul(pct).div(100), invoice);
    how = ` (${formatNumber(pct)}% of ${formatQuantity(invoice)})`;
  } else if (ap.nums.length === 1 && ap.pcts.length === 0) {
    paid = numberAt(ap, ap.nums[0], ctx).q;
    if (paid.kind === 'money' && invoice.kind === 'money' && paid.currency !== invoice.currency) paid = convertMoney(paid, invoice.currency!, ctx);
  } else throw new CalcError('payment amount?', 'e.g. pays 15000 or pays 65%');
  const remaining = moneyOrNumber(invoice.value.minus(paid.value), invoice.kind === 'number' ? paid : invoice);
  const invoiceText = invoice.note ? `invoice ${formatQuantity({ ...invoice, display: undefined })} · ${invoice.note}` : `owed ${formatQuantity(invoice)}`;
  return { ...remaining, note: `remaining after paying ${formatQuantity(paid)}${how} · ${invoiceText}` };
}

/** "I had 5000, spent 1275, received 450, how much is left" (mere paas 5000 the, 1275 kharch kiye, 450 mile, kitna bacha) */
function intentBalance(p: Parsed, ctx: EvalContext): Quantity | null {
  if (!p.has('had')) return null;
  const signWords: Record<string, 1 | -1> = { expenses: -1, remove: -1, minus: -1, '-': -1, pays: -1, received: 1, add: 1, plus: 1, '+': 1 };
  if (!p.words.some((w) => own(signWords, w))) return null;
  const used = new Set<number>();
  const startIdx = numberNear(p, p.idx('had'), used);
  if (startIdx === undefined) throw new CalcError('starting amount?', 'e.g. had 5000, spent 1275');
  const first = numberAt(p, startIdx, ctx);
  first.used.forEach((i) => used.add(i));
  let acc: Quantity = { ...first.q, note: undefined, display: undefined };
  const trail = [formatQuantity(acc)];
  const stop = (w: string) => w === ',' || NUM_RE.test(w) || PCT_RE.test(w);
  for (const i of [...p.nums, ...p.pcts].sort((a, b) => a - b)) {
    if (used.has(i)) continue;
    // the sign comes from the spent/received word right before the amount, else the one after it in the same clause, else before it
    let sign: 1 | -1 | undefined = own(signWords, p.words[i - 1] ?? '') ? signWords[p.words[i - 1]] : undefined;
    for (let j = i + 1; sign === undefined && j < p.words.length && (!stop(p.words[j]) || (p.words[j - 1] === 'and' && NUM_RE.test(p.words[j]))); j++) if (own(signWords, p.words[j])) sign = signWords[p.words[j]];
    for (let j = i - 1; sign === undefined && j >= 0 && !stop(p.words[j]); j--) if (own(signWords, p.words[j])) sign = signWords[p.words[j]];
    if (sign === undefined) throw new CalcError(`${p.words[i]}: spent or received?`, 'e.g. spent 1275, received 450');
    let amt: Quantity;
    if (PCT_RE.test(p.words[i])) {
      amt = moneyOrNumber(acc.value.mul(pctAt(p, i)).div(100), acc);
      used.add(i);
    } else {
      const r = numberAt(p, i, ctx);
      r.used.forEach((k) => used.add(k));
      amt = r.q;
      if (amt.kind === 'money' && acc.kind === 'money' && amt.currency !== acc.currency) amt = convertMoney(amt, acc.currency!, ctx);
    }
    acc = moneyOrNumber(sign > 0 ? acc.value.plus(amt.value) : acc.value.minus(amt.value), acc.kind === 'number' ? amt : acc);
    trail.push(`${sign > 0 ? '+' : '−'} ${formatQuantity(amt)}`);
  }
  if (trail.length === 1) return null;
  return { ...acc, note: `${trail.join(' ')} = ${formatQuantity(acc)}` };
}

/** "bmi 70 kg 175 cm", "bmi for 70 kg and 1.75 m", "70 kg, 5 ft 9 in, bmi" */
function intentBmi(p: Parsed, ctx: EvalContext): Quantity | null {
  if (!p.has('bmi')) return null;
  let mass: Quantity | null = null;
  const heightWords: string[] = [];
  for (const i of p.nums) {
    const word = p.words[i + 1] === 'in' ? 'inch' : (p.words[i + 1] ?? '');
    const u = findUnit(word);
    if (!u) continue;
    if (u.dim === 'mass' && !mass) mass = evalWords([p.words[i], word], ctx);
    else if (u.dim === 'length') heightWords.push(p.words[i], word);
  }
  if (!mass || !heightWords.length) throw new CalcError('weight and height?', 'e.g. bmi 70 kg 175 cm');
  const height = evalWords(heightWords, ctx);
  const kg = evalWords([`${mass.value.toString()} ${mass.unit}`, 'in', 'kg'], ctx).value;
  const m = evalWords([`${height.value.toString()} ${height.unit}`, 'in', 'm'], ctx).value;
  if (m.lte(0)) throw new CalcError('height must be positive');
  const bmi = kg.div(m.pow(2)).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  const band = bmi.lt('18.5') ? 'underweight' : bmi.lt(25) ? 'normal' : bmi.lt(30) ? 'overweight' : 'obese';
  return { kind: 'number', value: bmi, steps: [`BMI = weight ÷ height²`, `= ${formatQuantity(mass)} ÷ (${formatNumber(m, { maxDecimals: 3 })} m)² = ${formatNumber(bmi, { maxDecimals: 1 })}`, `${band} (WHO bands: under 18.5 underweight, 18.5–24.9 normal, 25–29.9 overweight, 30+ obese)`], note: `BMI = kg ÷ m² · ${formatQuantity(mass)} / (${formatNumber(m, { maxDecimals: 3 })} m)² · ${band} (WHO)` };
}

const PERIOD_PER_YEAR: Record<string, number> = { yearly: 1, quarterly: 4, monthly: 12, weekly: 52, daily: 365 };
const PERIOD_FROM_UNIT: Record<string, string> = { years: 'yearly', months: 'monthly', weeks: 'weekly', days: 'daily' };
/** "6 lakh per year in month", "50000 per month yearly", "1200 per day monthly" */
function intentPeriod(p: Parsed, ctx: EvalContext): Quantity | null {
  if (p.nums.length !== 1 || p.pcts.length) return null;
  const periods = p.words.map((w, i) => (own(PERIOD_PER_YEAR, w) ? w : own(PERIOD_FROM_UNIT, w) && (p.words[i - 1] === 'in' || p.words[i - 1] === 'to' || p.words[i - 1] === 'per') ? PERIOD_FROM_UNIT[w] : null)).filter((x): x is string => !!x);
  if (periods.length !== 2 || periods[0] === periods[1]) return null;
  const [from, to] = periods;
  const { q } = numberAt(p, p.nums[0], ctx);
  // months have 30 days and 4 weeks here; years 12 months, 52 weeks, 365 days
  const factor = from === 'daily' && to === 'monthly' ? 30 : from === 'monthly' && to === 'daily' ? 1 / 30 : from === 'weekly' && to === 'monthly' ? 4 : from === 'monthly' && to === 'weekly' ? 0.25 : PERIOD_PER_YEAR[from] / PERIOD_PER_YEAR[to];
  let out = moneyOrNumber(q.value.mul(factor), q);
  // "500 usd per month in inr per year": convert as well when a currency is named
  const target = targetCurrency(p);
  if (target && out.kind === 'money' && out.currency !== target) out = convertMoney(out, target, ctx);
  return { ...out, note: `${formatQuantity(q)} ${from} → ${to} (× ${formatNumber(new Decimal(factor), { maxDecimals: 4 })})` };
}

/** "2 GB at 50 Mbps", "how long to download 1.5 GB on 100 mbps", "2 GB in 10 seconds speed", "data in 1 hour at 10 mbps" */
function intentDataRate(p: Parsed, ctx: EvalContext): Quantity | null {
  if (p.pcts.length || p.nums.length < 2) return null;
  const unitAt = (i: number) => {
    const one = p.words[i + 1];
    const two = `${p.words[i + 1]} ${p.words[i + 2]}`;
    const three = `${p.words[i + 1]} ${p.words[i + 2]} ${p.words[i + 3]}`;
    return findUnit(three) ? { u: findUnit(three)!, text: three } : findUnit(two) ? { u: findUnit(two)!, text: two } : one && findUnit(one) ? { u: findUnit(one)!, text: one } : null;
  };
  const q = (i: number, text: string) => evalWords([p.words[i], text], ctx);
  const pick = (dim: string) => {
    for (const i of p.nums) {
      const u = unitAt(i);
      if (u && u.u.dim === dim) return { i, text: u.text };
    }
    return null;
  };
  const data = pick('data');
  const rate = pick('bandwidth');
  const time = pick('time');
  if (data && rate) {
    const r = divQ(q(data.i, data.text), q(rate.i, rate.text));
    const note = `${formatQuantity(q(data.i, data.text))} ÷ ${formatQuantity(q(rate.i, rate.text))}`;
    // "… in hours": the duration in the unit asked for
    const last = p.words.length - 1;
    const tail = p.words[last];
    if ((p.words[last - 1] === 'in' || p.words[last - 1] === 'to') && findUnit(tail)?.dim === 'time' && !p.nums.includes(last - 1)) {
      return { ...evalWords([`${r.value.toString()} s`, 'in', tail], ctx), note };
    }
    return { ...r, note };
  }
  if (rate && time) {
    const r = mulQ(q(rate.i, rate.text), q(time.i, time.text));
    return { ...r, note: `${formatQuantity(q(rate.i, rate.text))} × ${formatQuantity(q(time.i, time.text))}` };
  }
  if (data && time) {
    const r = divQ(q(data.i, data.text), q(time.i, time.text));
    return { ...r, note: `${formatQuantity(q(data.i, data.text))} ÷ ${formatQuantity(q(time.i, time.text))}` };
  }
  return null;
}

/** "7.85 kilometres to metres, miles and feet" / "5 hours 42 minutes in total minutes and decimal hours" */
function intentConvertMulti(p: Parsed, ctx: EvalContext): Quantity | null {
  if (p.nums.length === 0 || p.pcts.length) return null;
  const last = p.words.length - 1;
  if (p.words[last] === 'in' && last >= 2 && (isUnitWord(p.words[last - 1]) || isUnitWord(`${p.words[last - 2]} ${p.words[last - 1]}`) || !!findCurrency(p.words[last - 1]))) {
    const two = isUnitWord(`${p.words[last - 2]} ${p.words[last - 1]}`);
    const target = two ? `${p.words[last - 2]} ${p.words[last - 1]}` : p.words[last - 1];
    const srcWords = p.words.slice(0, two ? last - 2 : last - 1).filter((w) => w !== ',' && w !== 'convert' && w !== 'what' && w !== 'is');
    try {
      const src = evalWords(srcWords, ctx);
      if (src.kind === 'unit' || src.kind === 'money') return evalWords([src.kind === 'money' ? `${src.value.toString()} ${src.currency}` : `${src.value.toString()} ${src.unit}`, 'in', target], ctx);
    } catch {
      return null;
    }
  }
  const sep = p.words.findIndex((w, i) => (w === 'in' || w === 'to') && i > p.nums[0]);
  if (sep < 0) return null;
  const srcWords = p.words.slice(0, sep).filter((w) => w !== 'convert' && w !== 'what');
  const noise = new Set(['total', 'decimal', 'approximately', 'approx', 'equivalent']);
  const targets: string[] = [];
  let cur: string[] = [];
  for (const w of p.words.slice(sep + 1)) {
    if (w === ',' || w === 'and') {
      if (cur.length) targets.push(cur.join(' '));
      cur = [];
    } else if (!noise.has(w)) cur.push(w);
  }
  if (cur.length) targets.push(cur.join(' '));
  if (targets.length === 2 && targets[1] === 'in') targets[1] = 'inch';
  if (targets.length < 2 || !targets.every((t) => isUnitWord(t) || !!findCurrency(t))) return null;
  let src: Quantity;
  try {
    src = evalWords(srcWords, ctx);
  } catch {
    return null;
  }
  if (src.kind !== 'unit' && src.kind !== 'money' && src.kind !== 'number') return null;
  const srcText = src.kind === 'money' ? `${src.value.toString()} ${src.currency}` : src.kind === 'unit' ? `${src.value.toString()} ${src.unit}` : src.value.toString();
  // "180 cm in ft and in", "1 kg in lb and oz": two units of one dimension, larger first, is a compound answer
  if (targets.length === 2 && src.kind === 'unit') {
    const [a, b] = [findUnit(targets[0]), findUnit(targets[1])];
    const pairs = new Set(['ft inch', 'lb oz', 'h min', 'min s', 'kg g', 'm cm', 'st lb', 'day h']);
    if (a && b && pairs.has(`${a.id} ${b.id}`) && a.dim === findUnit(src.unit!)?.dim) return evalWords([srcText, 'in', targets[0], 'and', targets[1]], ctx);
  }
  const results = targets.map((t) => evalWords([srcText, 'in', t], ctx));
  const shown = results.map((r) => formatQuantity(r));
  return { ...results[0], display: shown.join(' · '), note: shown.includes(formatQuantity(src)) ? undefined : formatQuantity(src) };
}

export function runIntents(raw: string, ctx: EvalContext): IntentResult | null {
  // "distance from earth to moon", "everest ki height", "speed of light": reference facts (before zones: "great wall of china")
  // facts that are not calculations ("unit of electricity", "full form of emi", "80c limit")
  const fixed = lookupFixed(raw);
  if (fixed) return fixed;
  const fact = lookupFact(raw);
  if (fact) return fact.q;
  const { words, notes } = normalize(raw);
  // everyday calculators (tax, SIP, festivals, equations, …) see the raw line and the words
  if (words.length) {
    const ex = extraIntents(raw, analyse(words, notes), ctx, (ws) => intentTimeSpan(analyse(ws, []), ctx));
    if (ex) return notes.length && !ex.note?.includes(notes[0]) ? { ...ex, note: ex.note ? `${ex.note} · ${notes.join(' · ')}` : notes.join(' · ') } : ex;
  }
  const tz = intentTimezone(raw, ctx);
  if (tz) return tz;
  return runIntentWords(words, notes, ctx);
}

export function runIntentWords(words: string[], notes: string[], ctx: EvalContext): IntentResult | null {
  if (words.length === 0) return null;
  // plain arithmetic in words ("what 35% of 840 add 12% of 1250", "2 ^ 15") goes straight to the parser
  const pure = pureExpression(words, ctx);
  if (pure) {
    const t = traced(() => evalWords([pure], ctx));
    const q: Quantity = t.steps.length ? { ...t.value, steps: t.steps } : t.value;
    return notes.length ? { ...q, note: q.note ? `${q.note} · ${notes.join(' · ')}` : notes.join(' · ') } : q;
  }
  // "40% of x is 80, x?": an undefined x stands for the unknown
  const p = analyse(ctx.variables.has('x') ? words : words.map((w) => (w === 'x' ? 'what' : w)), notes);
  const order: ((p: Parsed, ctx: EvalContext) => IntentResult | Quantity | null)[] = [
    intentBmi, intentPeriod, intentEmi, intentInterest, intentOwes, intentBalance, intentBusiness, intentAllocate, intentRatio, intentList, intentTimeSpan, intentDataRate, intentConvertMulti, intentChain, intentMarginMarkup, intentGst, intentDiscount, intentProfitLoss, intentDates, intentQuantity, intentDivide, intentPercentQuestions, intentIncreaseDecrease, intentConvert,
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
  if (words.some((w) => ['monthly', 'yearly', 'quarterly', 'daily', 'half-yearly', 'weekly'].includes(w))) return null;
  // an incomplete expression ("5 +") must stay an error, not be trimmed into "5"
  const ops = (ws: string[]) => ws.filter((w) => ARITH_OPS.includes(w)).length;
  if (ops(words) !== ops(keep)) return null;
  // keep conversion words between operands ("100 dollar in rupee")
  const withConv = words.filter((w) => keep.includes(w) || w === 'in' || w === 'to' || w === 'as' || w === 'of' || w === 'off' || w === 'on' || w === 'prev' || w === 'that').map((w) => (w === 'that' ? 'prev' : w));
  // "10% of", "of 10%", "100 usd in": a dangling connector means the sentence is unfinished — say so instead of trimming it away
  if (withConv.length && ['of', 'on', 'in', 'to', 'off'].includes(withConv[withConv.length - 1])) return null;
  if (withConv.length && ['of', 'on', 'to', 'off'].includes(withConv[0])) return null;
  while (withConv.length && withConv[0] === 'in') withConv.shift();
  if (withConv.length === 0) return null;
  return withConv.join(' ');
}
