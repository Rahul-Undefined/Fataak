/**
 * Intent matching over normalised words. Each intent either returns a Quantity, throws a
 * CalcError with a hint (the intent matched but something is missing/ambiguous), or returns
 * null (does not apply).
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
import { isUnitWord } from '../units';

const PCT_RE = /^(\d+(?:\.\d+)?)%$/;
const NUM_RE = /^[₹$€£¥৳]?\d[\d,]*(?:\.\d+)?$/;
const TIME_UNITS = new Set(['years', 'months', 'weeks', 'days', 'hours', 'minutes']);
const CONNECTORS = new Set(['of', 'on', 'in', 'to', 'from', 'for', 'at', 'by', 'and', 'with', 'what', 'after', 'before', 'between', 'is', 'than', 'then', 'now', 'time']);
const VERBS = new Set(['increase', 'decrease', 'add', 'remove', 'inclusive', 'without', 'gst', 'discount', 'profit', 'loss', 'cost', 'sell', 'margin', 'markup', 'emi', 'loan', 'interest', 'simple', 'compound', 'convert', 'change']);
const SCALE_WORDS = new Set(['k', 'thousand', 'hazaar', 'hazar', 'hajar', 'lakh', 'lakhs', 'lac', 'lacs', 'crore', 'crores', 'cr', 'koti', 'lokkho', 'million', 'mn', 'billion', 'bn', 'hundred']);

interface Parsed {
  words: string[];
  pcts: number[]; // indices of percent tokens
  nums: number[]; // indices of number tokens (incl. ₹500)
  has: (w: string) => boolean;
  idx: (w: string) => number;
  notes: string[];
}

function analyse(words: string[], notes: string[]): Parsed {
  const pcts: number[] = [];
  const nums: number[] = [];
  words.forEach((w, i) => {
    if (PCT_RE.test(w)) pcts.push(i);
    else if (NUM_RE.test(w)) nums.push(i);
  });
  return { words, pcts, nums, has: (w) => words.includes(w), idx: (w) => words.indexOf(w), notes };
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

/** A number token (possibly with currency symbol / following scale word / currency word) → Quantity. */
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

/** Words left over after removing used indices, verbs, connectors and percents → base expression. */
const OPERATOR_WORDS = new Set(['+', '-', '*', '/', '^', '(', ')', 'x', 'times', 'plus', 'minus', 'mod', 'sum', 'total', 'avg', 'average', 'prev', 'ans']);

/** words that can take part in a base expression: numbers, variables, units, currencies, scales, operators */
function expressionWords(p: Parsed, used: Set<number>, ctx: EvalContext): string[] {
  const rest = p.words.filter((w, i) => !used.has(i) && !VERBS.has(w) && !CONNECTORS.has(w) && !PCT_RE.test(w) && w !== '%' && !TIME_UNITS.has(w));
  const keep = rest.filter((w) => NUM_RE.test(w) || /^[(),.]*[\d₹$€£¥৳]/.test(w) || OPERATOR_WORDS.has(w) || ctx.variables.has(w) || SCALE_WORDS.has(w) || isUnitWord(w) || isCurrencyWord(w) || !!currencyBySymbol(w));
  // multi-word variables ("basic salary") are matched as a phrase
  for (let n = 4; n >= 2; n--) {
    for (let i = 0; i + n <= rest.length; i++) {
      const phrase = rest.slice(i, i + n).join(' ');
      if (ctx.variables.has(phrase) && !keep.includes(phrase)) keep.push(phrase);
    }
  }
  while (keep.length && ['+', '-', '*', '/', '^', 'x', 'times', 'plus', 'minus'].includes(keep[keep.length - 1])) keep.pop();
  while (keep.length && ['+', '*', '/', '^', 'x', 'times', 'plus', 'minus'].includes(keep[0])) keep.shift();
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
    // number before the unit
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

// ---------------------------------------------------------------- intents

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
  const wantsNow = !time && (wordList.includes('time') || wordList.includes('now'));
  if (zones.length === 0) return null;
  if (!time && !wantsNow) return null;
  if (!time) {
    // "time in tokyo", "tokyo time", "new york time now"
    return nowInZone(zones[zones.length - 1].ref, ctx.now());
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
    // one zone: "6pm to EST" (local → EST) vs "6pm IST" (just restate) — look for a connector before the zone
    const z = zones[0];
    const before = wordList.slice(0, z.start);
    const hasTo = before.some((w) => w === 'to' || w === 'in');
    const local: ZoneRef = { zone: ctx.zone, label: 'local' };
    if (hasTo) {
      fromRef = local;
      toRef = z.ref;
    } else {
      // "6pm IST in local" / "6pm IST" → convert to local zone
      fromRef = z.ref;
      toRef = local;
      if (fromRef.zone === toRef.zone) return null;
    }
  }
  const conv = convertTime({ hour: time.hour, minute: time.minute, date, fromRef, toRef, now: ctx.now() });
  return tzResultQuantity(conv);
}

function intentDates(p: Parsed, ctx: EvalContext): Quantity | null {
  const w = p.words;
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
  // two dates → difference in days ("1 jan 2026 to 15 mar 2026", "days between a and b")
  if (dates.length >= 2) {
    const a = dates[0].q.date!;
    const b = dates[1].q.date!;
    const days = b.startOf('day').diff(a.startOf('day'), 'days').days;
    return { kind: 'unit', value: new Decimal(days), unit: 'day', note: `${a.toFormat('d LLL yyyy')} → ${b.toFormat('d LLL yyyy')}` };
  }
  // one date + duration → shifted date ("today from 45 days after", "45 days after today", "today + 45 days")
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
    // bare date question: "what day is 15 aug 2026" → show weekday
    const d = dates[0].q.date!;
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
  const compound = p.has('compound');
  if (compound) {
    const freq: fin.Compounding = p.has('monthly') ? 'monthly' : p.has('quarterly') ? 'quarterly' : p.has('half-yearly') ? 'half-yearly' : p.has('daily') ? 'daily' : 'yearly';
    const r = fin.compoundInterest(principal.value, rate, years, freq);
    const q = moneyOrNumber(r.interest, principal);
    return { ...q, note: `compound ${freq} · total ${formatQuantity(moneyOrNumber(r.total, principal))}` };
  }
  const r = fin.simpleInterest(principal.value, rate, years);
  const q = moneyOrNumber(r.interest, principal);
  return { ...q, note: `simple interest · total ${formatQuantity(moneyOrNumber(r.total, principal))}` };
}

/** pick the number nearest to a marker word (prefer the one after it) */
function numberNear(p: Parsed, marker: number, used: Set<number>): number | undefined {
  const LINK = new Set(['at', 'in', 'on', 'of', 'for', 'to', 'from', 'with']);
  const after = p.words[marker + 1];
  const before = p.words[marker - 1];
  // English: "bought at 500" / "cost 500" → look forward. Hinglish/Bengalish: "500 me kharida" → look backward.
  const forwardFirst = before !== undefined && LINK.has(before) ? false : (after !== undefined && (LINK.has(after) || p.nums.includes(marker + 1))) || before === undefined || !p.nums.includes(marker - 1);
  const scan = (dir: 1 | -1): number | undefined => {
    for (let i = marker + dir; i >= 0 && i < p.words.length; i += dir) {
      if (p.nums.includes(i) && !used.has(i)) return i;
      if (VERBS.has(p.words[i]) && p.words[i] !== 'cost' && p.words[i] !== 'sell') break;
    }
    return undefined;
  };
  return forwardFirst ? (scan(1) ?? scan(-1)) : (scan(-1) ?? scan(1));
}

function intentProfitLoss(p: Parsed, ctx: EvalContext): Quantity | null {
  const hasCost = p.has('cost');
  const hasSell = p.has('sell');
  const hasPL = p.has('profit') || p.has('loss');
  if (!hasCost && !hasSell && !hasPL) return null;
  if (p.has('margin') || p.has('markup')) return null;
  const used = new Set<number>();
  // "20% profit on 500" → selling price
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
  const reverse = p.has('remove') || p.has('inclusive') || p.has('without') || p.has('-') || (p.has('from') && !p.has('add'));
  const addMode = p.has('add') || p.has('with') || p.has('on') || p.has('increase') || p.has('+');
  if (reverse) {
    const r = fin.gstRemove(base.value, rate);
    return { ...moneyOrNumber(r.base, base), note: `before GST · GST ${formatQuantity(moneyOrNumber(r.tax, base))} @ ${formatNumber(rate)}%` };
  }
  const r = fin.gstAdd(base.value, rate);
  if (addMode) return { ...moneyOrNumber(r.total, base), note: `incl. GST ${formatQuantity(moneyOrNumber(r.tax, base))} @ ${formatNumber(rate)}%` };
  // no verb: show the GST amount, with the total alongside
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
  const rate = pctAt(p, p.pcts[0]);
  const used = new Set<number>([p.pcts[0]]);
  const base = remainingBase(p, used, ctx);
  const r = fin.discount(base.value, rate);
  return { ...moneyOrNumber(r.final, base), note: `saved ${formatQuantity(moneyOrNumber(r.saved, base))} @ ${formatNumber(rate)}%` };
}

function intentIncreaseDecrease(p: Parsed, ctx: EvalContext): Quantity | null {
  const inc = p.has('increase') || p.has('add');
  const dec = p.has('decrease') || p.has('remove');
  if (!inc && !dec) return null;
  const sign = dec ? -1 : 1;
  if (p.pcts.length >= 1) {
    const rate = pctAt(p, p.pcts[0]);
    const used = new Set<number>([p.pcts[0]]);
    const base = remainingBase(p, used, ctx);
    const result = base.value.mul(new Decimal(100).plus(rate.mul(sign))).div(100);
    const delta = result.minus(base.value);
    const q = moneyOrNumber(result, base);
    return { ...q, note: `${delta.isNegative() ? '−' : '+'}${formatQuantity(moneyOrNumber(delta.abs(), base))} on ${formatQuantity(base)}` };
  }
  // "increase salary by 5000": base + amount
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

/** 20% of what is 30 cm · 30 is what % of 150 · 150 to 200 what % change */
function intentPercentQuestions(p: Parsed, ctx: EvalContext): Quantity | null {
  const w = p.words;
  const wi = p.idx('what');
  const bare = w.indexOf('%');
  const numberAfterWhat = wi >= 0 && p.nums.some((i) => i > wi);
  const adjacentWhat = numberAfterWhat && p.pcts.length === 1 && (w[p.pcts[0] + 1] === 'what' || (['of', 'on', 'off'].includes(w[p.pcts[0] + 1]) && w[p.pcts[0] + 2] === 'what'));
  if (adjacentWhat && wi >= 0 && p.nums.length === 1) {
    // P% of/on/off what is X
    const pct = pctAt(p, p.pcts[0]);
    const { q: x } = numberAt(p, p.nums[0], ctx);
    const mode = w[p.pcts[0] + 1];
    let v: Decimal;
    if (mode === 'on') v = x.value.div(new Decimal(100).plus(pct)).mul(100);
    else if (mode === 'off' || p.has('discount') || p.has('decrease')) v = x.value.div(new Decimal(100).minus(pct)).mul(100);
    else v = x.value.div(pct).mul(100);
    return moneyOrNumber(v, x);
  }
  if (p.has('change') && p.nums.length === 1 && p.pcts.length === 1 && p.pcts[0] > p.nums[0]) {
    const { q: a } = numberAt(p, p.nums[0], ctx);
    const b = pctAt(p, p.pcts[0]);
    const pct = fin.percentChange(a.value, b);
    return { kind: 'percent', value: pct, note: `${formatQuantity(a)} → ${formatQuantity(moneyOrNumber(b, a))}` };
  }
  if (p.nums.length === 2 && (bare >= 0 || (wi >= 0 && (p.has('change') || p.has('increase') || p.has('decrease') || p.has('of'))))) {
    const { q: a } = numberAt(p, p.nums[0], ctx);
    const { q: b } = numberAt(p, p.nums[1], ctx);
    const av = a.kind === 'money' && b.kind === 'money' && a.currency !== b.currency ? convertMoney(a, b.currency!, ctx).value : a.value;
    if (p.has('change') || p.has('increase') || p.has('decrease') || p.has('from') || p.has('to')) {
      const pct = fin.percentChange(av, b.value);
      return { kind: 'percent', value: pct, note: `${formatQuantity(a)} → ${formatQuantity(b)} (${pct.isNegative() ? '−' : '+'}${formatQuantity(moneyOrNumber(b.value.minus(av).abs(), b))})` };
    }
    // "30 is what % of 150" / "what % of 150 is 30": the number after "of" is the base
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
    // multi-word unit like "tea spoons"
    const rest = p.words.filter((w, i) => !used.has(i) && !VERBS.has(w) && !CONNECTORS.has(w)).join(' ');
    if (!rest || !(isUnitWord(rest) || findCurrency(rest))) return null;
    return evalWords([q.kind === 'money' ? `${q.value.toString()} ${q.currency}` : q.kind === 'unit' ? `${q.value.toString()} ${q.unit}` : q.value.toString(), 'in', rest], ctx);
  }
  const target = targets[0].w;
  const src = q.kind === 'money' ? `${q.value.toString()} ${q.currency}` : q.kind === 'unit' ? `${q.value.toString()} ${q.unit}` : q.value.toString();
  return evalWords([src, 'in', target], ctx);
}

export function runIntents(raw: string, ctx: EvalContext): Quantity | null {
  const tz = intentTimezone(raw, ctx);
  if (tz) return tz;
  const { words, notes } = normalize(raw);
  if (words.length === 0) return null;
  const p = analyse(words, notes);
  const order = [intentEmi, intentInterest, intentMarginMarkup, intentGst, intentDiscount, intentProfitLoss, intentDates, intentPercentQuestions, intentIncreaseDecrease, intentConvert];
  for (const intent of order) {
    const r = intent(p, ctx);
    if (r) {
      if (notes.length && !r.note?.includes(notes[0])) r.note = r.note ? `${r.note} · ${notes.join(' · ')}` : notes.join(' · ');
      return r;
    }
  }
  return null;
}

/** canonical words → expression text for the last-resort parse ("25000 of 18%" etc.) */
export function expressionFallback(raw: string): string | null {
  const { words } = normalize(raw);
  const keep = words.filter((w) => !VERBS.has(w) && !['what', 'is', 'for', 'at', 'by', 'from', 'after', 'before', 'between', 'with', 'now', 'time', 'then', 'than'].includes(w));
  if (keep.length === 0) return null;
  // drop dangling connectors at the ends
  while (keep.length && ['of', 'on', 'in', 'to', 'and'].includes(keep[keep.length - 1])) keep.pop();
  while (keep.length && ['of', 'on', 'in', 'to', 'and'].includes(keep[0])) keep.shift();
  if (keep.length === 0) return null;
  return keep.join(' ');
}
