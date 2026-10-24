/**
 * Everyday calculators layered on the intent model: Indian income tax and salary, SIP/FD/RD, loan
 * prepayment, inflation, rent, bill shares, cooking measures, sizes, fuel and electricity costs,
 * festivals and birthdays, shift hours, number words and bases, health, study, proportion problems,
 * equations in x, statistics and ranges. Every formula and assumption is stated in the note.
 */
import { DateTime } from 'luxon';
import { CalcError, Decimal, own, type EvalContext, type Quantity } from './types';
import { analyse, evalWords, numberAt, moneyOrNumber, type Parsed } from './nl/intents';
import { formatNumber, formatQuantity } from './format';
import { findUnit } from './units';
import { cityDistanceKm, CITIES } from './facts';

const D = (v: Decimal.Value) => new Decimal(v);
let RAW = '';
const money2 = (v: Decimal) => v.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
const PCT_RE = /^(\d+(?:\.\d+)?)%$/;
const NUM_RE = /^[₹$€£¥]?\d[\d,]*(?:\.\d+)?$/;

function nums(p: Parsed, ctx: EvalContext): Quantity[] {
  return p.nums.map((i) => numberAt(p, i, ctx).q);
}
function pcts(p: Parsed): Decimal[] {
  return p.pcts.map((i) => D(p.words[i].slice(0, -1)));
}
/** the number right after a marker word, as a Quantity */
function after(p: Parsed, word: string, ctx: EvalContext): Quantity | null {
  const i = p.idx(word);
  if (i < 0) return null;
  const n = p.nums.find((k) => k > i && k <= i + 3);
  return n === undefined ? null : numberAt(p, n, ctx).q;
}
/** years from "N years" / "N months" in the words */
function tenureYears(p: Parsed): Decimal | null {
  for (const i of p.nums) {
    const u = p.words[i + 1];
    if (u === 'years') return D(p.words[i].replace(/[^\d.]/g, ''));
    if (u === 'months') return D(p.words[i].replace(/[^\d.]/g, '')).div(12);
  }
  return null;
}
function yrs(v: Decimal): string {
  const y = Math.floor(v.toNumber());
  const m = Math.round((v.toNumber() - y) * 12);
  return m ? `${y} years ${m} months` : `${y} years`;
}

// ---------------------------------------------------------------- A. money and tax
const OLD_SLABS: [number, number][] = [[250000, 0], [500000, 5], [1000000, 20], [Infinity, 30]];
/** new-regime slabs by financial year (FY 2025-26 = 2025), with the 87A rebate limit and the salaried standard deduction */
const NEW_REGIME: Record<number, { slabs: [number, number][]; rebate: number; stdDed: number; label: string }> = {
  2023: { slabs: [[300000, 0], [600000, 5], [900000, 10], [1200000, 15], [1500000, 20], [Infinity, 30]], rebate: 700000, stdDed: 50000, label: 'FY 2023-24' },
  2024: { slabs: [[300000, 0], [700000, 5], [1000000, 10], [1200000, 15], [1500000, 20], [Infinity, 30]], rebate: 700000, stdDed: 75000, label: 'FY 2024-25' },
  2025: { slabs: [[400000, 0], [800000, 5], [1200000, 10], [1600000, 15], [2000000, 20], [2400000, 25], [Infinity, 30]], rebate: 1200000, stdDed: 75000, label: 'FY 2025-26' },
};
export const DEFAULT_FY = 2025;
/** surcharge on income above 50 lakh (new regime capped at 25%; old regime 37% above 5 crore) */
function surchargeRate(income: Decimal, old: boolean): number {
  if (income.gt(50000000)) return old ? 37 : 25;
  if (income.gt(20000000)) return 25;
  if (income.gt(10000000)) return 15;
  if (income.gt(5000000)) return 10;
  return 0;
}

function slabTax(taxable: Decimal, slabs: [number, number][]): Decimal {
  let tax = D(0);
  let lower = D(0);
  for (const [upper, rate] of slabs) {
    if (taxable.lte(lower)) break;
    const part = Decimal.min(taxable, upper).minus(lower);
    tax = tax.plus(part.mul(rate).div(100));
    lower = D(upper);
  }
  return tax;
}

/**
 * Indian income tax: new regime by default (FY 2025-26 unless another known year is named), old regime on request.
 * Rebate 87A with marginal relief, surcharge above 50 lakh with marginal relief, 4% cess.
 */
export function incomeTax(income: Decimal, opts: { old?: boolean; salaried?: boolean; fy?: number }): { tax: Decimal; taxable: Decimal; slab: Decimal; surcharge: Decimal; cess: Decimal; deduction: Decimal; regime: string } {
  const fy = opts.fy ?? DEFAULT_FY;
  const year = NEW_REGIME[fy];
  if (!year) throw new CalcError(`tax slabs for FY ${fy}-${String(fy + 1).slice(2)} are not loaded`, 'FY 2023-24, 2024-25 and 2025-26 are known');
  const deduction = opts.salaried ? D(opts.old ? 50000 : year.stdDed) : D(0);
  const taxable = Decimal.max(0, income.minus(deduction));
  const slabs = opts.old ? OLD_SLABS : year.slabs;
  let slab = slabTax(taxable, slabs);
  const rebateLimit = opts.old ? D(500000) : D(year.rebate);
  if (taxable.lte(rebateLimit)) slab = D(0);
  else if (!opts.old) slab = Decimal.min(slab, taxable.minus(rebateLimit)); // marginal relief just above the rebate limit
  // surcharge with marginal relief: tax + surcharge never exceeds what is due at the threshold plus the income above it
  const rate = surchargeRate(taxable, !!opts.old);
  let surcharge = slab.mul(rate).div(100);
  if (rate > 0) {
    const threshold = [50000000, 20000000, 10000000, 5000000].find((t) => taxable.gt(t))!;
    const atThreshold = slabTax(D(threshold), slabs);
    const dueAtThreshold = atThreshold.plus(atThreshold.mul(surchargeRate(D(threshold), !!opts.old)).div(100));
    const excess = taxable.minus(threshold);
    if (slab.plus(surcharge).minus(dueAtThreshold).gt(excess)) surcharge = dueAtThreshold.plus(excess).minus(slab);
  }
  const cess = slab.plus(surcharge).mul(4).div(100);
  return { tax: money2(slab.plus(surcharge).plus(cess)), taxable, slab, surcharge, cess, deduction, regime: `${opts.old ? 'old regime' : 'new regime'} ${year.label}` };
}

function intentIncomeTax(p: Parsed, ctx: EvalContext): Quantity | null {
  if (!p.has('itax') && !((p.has('salary') || p.has('revenue')) && p.has('gst') && p.pcts.length === 0)) return null;
  const amounts = nums(p, ctx).filter((q) => !q.unit);
  if (!amounts.length) throw new CalcError('income?', 'e.g. income tax on 12 lakh');
  const income = amounts.reduce((m, q) => (q.value.gt(m.value) ? q : m));
  const old = p.has('oldregime');
  const salaried = p.has('salary') || p.has('ctc') || p.has('salaried');
  const fyWords = p.words.filter((w) => /^fy\d{4}$/.test(w));
  if (new Set(fyWords).size > 1) throw new CalcError('which financial year?', 'name one year, e.g. fy 2024-25');
  const fyWord = fyWords[0];
  const r = incomeTax(income.value, { old, salaried, fy: fyWord ? parseInt(fyWord.slice(2), 10) : undefined });
  const money = (v: Decimal) => formatQuantity(moneyOrNumber(money2(v), income));
  // slab by slab
  const fyKey = fyWord ? parseInt(fyWord.slice(2), 10) : DEFAULT_FY;
  const slabs = old ? OLD_SLABS : NEW_REGIME[fyKey]?.slabs ?? NEW_REGIME[DEFAULT_FY].slabs;
  const steps: string[] = [];
  if (r.deduction.gt(0)) steps.push(`taxable income: ${money(income.value)} − ${money(r.deduction)} standard deduction = ${money(r.taxable)}`);
  else steps.push(`taxable income: ${money(r.taxable)}`);
  let lower = D(0);
  for (const [upper, rate] of slabs) {
    if (r.taxable.lte(lower)) break;
    const part = Decimal.min(r.taxable, upper).minus(lower);
    if (rate === 0) steps.push(`up to ${money(D(upper))}: 0%`);
    else steps.push(`${money(lower)} to ${upper === Infinity ? 'above' : money(D(upper))}: ${money(part)} × ${rate}% = ${money(part.mul(rate).div(100))}`);
    lower = D(upper);
  }
  const rawSlab = slabTax(r.taxable, slabs);
  if (r.slab.lt(rawSlab)) steps.push(r.slab.isZero() ? `rebate 87A: taxable income within the limit, tax = 0` : `marginal relief: tax capped at income above the limit = ${money(r.slab)}`);
  else steps.push(`slab tax = ${money(r.slab)}`);
  if (r.surcharge.gt(0)) steps.push(`surcharge = ${money(r.surcharge)}`);
  steps.push(`cess: ${money(r.slab.plus(r.surcharge))} × 4% = ${money(r.cess)}`);
  steps.push(`total tax = ${money(r.tax)} (${money(r.tax.div(12))} per month)`);
  return {
    ...moneyOrNumber(r.tax, income),
    steps,
    note: `${r.regime} · taxable ${money(r.taxable)}${r.deduction.gt(0) ? ` after ${money(r.deduction)} standard deduction` : ''} · slab tax ${money(r.slab)}${r.surcharge.gt(0) ? ` + surcharge ${money(r.surcharge)}` : ''} + 4% cess ${money(r.cess)} · ${money(r.tax.div(12))} per month`,
  };
}

/** CTC → monthly in-hand: basic 50% of CTC, employee and employer PF 12% of basic, professional tax 2,400/yr, income tax new regime */
function intentInHand(p: Parsed, ctx: EvalContext): Quantity | null {
  if (!p.has('ctc') && !p.has('inhand')) return null;
  const amounts = nums(p, ctx);
  if (!amounts.length) throw new CalcError('CTC amount?', 'e.g. ctc 12 lakh in hand');
  const ctc = amounts.reduce((m, q) => (q.value.gt(m.value) ? q : m));
  const basic = ctc.value.mul(0.5);
  const pf = basic.mul(0.12);
  const pt = D(2400);
  const gross = ctc.value.minus(pf); // employer PF sits inside CTC
  const tax = incomeTax(gross, { salaried: true, old: p.has('oldregime') }).tax;
  const yearly = gross.minus(pf).minus(pt).minus(tax);
  const monthly = money2(yearly.div(12));
  const money = (v: Decimal) => formatQuantity(moneyOrNumber(money2(v), ctc));
  return { ...moneyOrNumber(monthly, ctc), display: `${money(monthly)}/month`, note: `in hand ${money(yearly)} per year · CTC ${money(ctc.value)} − employer PF ${money(pf)} − employee PF ${money(pf)} − professional tax ${money(pt)} − income tax ${money(tax)} (new regime) · assumes basic = 50% of CTC` };
}

/** SIP future value with monthly compounding, instalment at the start of each month */
export function sipValue(monthly: Decimal, ratePct: Decimal, months: number): Decimal {
  const r = ratePct.div(1200);
  if (r.isZero()) return monthly.mul(months);
  const g = D(1).plus(r).pow(months);
  return monthly.mul(g.minus(1)).div(r).mul(D(1).plus(r));
}

function intentSip(p: Parsed, ctx: EvalContext): Quantity | null {
  if (!p.has('sip')) return null;
  const rate = pcts(p)[0];
  const years = tenureYears(p);
  if (!rate || !years) throw new CalcError('SIP needs amount, rate and years', 'e.g. sip 5000 at 12% for 10 years');
  const months = Math.round(years.mul(12).toNumber());
  const amounts = nums(p, ctx).filter((q, k) => !['years', 'months'].includes(p.words[p.nums[k] + 1]));
  // goal: "how much sip for 50 lakh in 10 years at 12%"
  if (p.has('what') || p.has('for')) {
    const target = amounts.find((q) => p.words[p.nums[amounts.indexOf(q)] - 1] === 'for') ?? (p.has('what') ? amounts[0] : undefined);
    if (target && (p.has('what') || target.value.gte(100000))) {
      const unit = sipValue(D(1), rate, months);
      const monthly = money2(target.value.div(unit));
      return { ...moneyOrNumber(monthly, target), display: `${formatQuantity(moneyOrNumber(monthly, target))}/month`, note: `to reach ${formatQuantity(target)} in ${yrs(years)} at ${formatNumber(rate)}% · total invested ${formatQuantity(moneyOrNumber(money2(monthly.mul(months)), target))}` };
    }
  }
  const monthly = amounts[0];
  if (!monthly) throw new CalcError('monthly SIP amount?', 'e.g. sip 5000 at 12% for 10 years');
  const fv = money2(sipValue(monthly.value, rate, months));
  const invested = monthly.value.mul(months);
  const rm = rate.div(1200);
  const fm = (v: Decimal) => formatQuantity(moneyOrNumber(money2(v), monthly));
  const sipSteps = [
    `monthly rate r = ${formatNumber(rate)}% ÷ 12 = ${formatNumber(rm.mul(100), { maxDecimals: 4 })}%`,
    `months n = ${months}`,
    `FV = P × ((1 + r)^n − 1) ÷ r × (1 + r)`,
    `(1 + r)^n = ${formatNumber(D(1).plus(rm).pow(months), { maxDecimals: 4 })}`,
    `FV = ${fm(monthly.value)} × ${formatNumber(D(1).plus(rm).pow(months).minus(1).div(rm).mul(D(1).plus(rm)), { maxDecimals: 4 })} = ${fm(fv)}`,
    `invested ${fm(invested)} · gain ${fm(fv.minus(invested))}`,
  ];
  return { ...moneyOrNumber(fv, monthly), steps: sipSteps, note: `invested ${formatQuantity(moneyOrNumber(invested, monthly))} · gain ${formatQuantity(moneyOrNumber(money2(fv.minus(invested)), monthly))} · ${formatNumber(rate)}% a year compounded monthly, ${months} instalments` };
}

/** "lumpsum 1 lakh at 10% for 15 years" → yearly compounding */
function intentLumpsum(p: Parsed, ctx: EvalContext): Quantity | null {
  if (!p.has('lumpsum')) return null;
  const rate = pcts(p)[0];
  const years = tenureYears(p);
  const amount = nums(p, ctx).find((q, k) => !['years', 'months'].includes(p.words[p.nums[k] + 1]));
  if (!rate || !years || !amount) throw new CalcError('amount, rate and years?', 'e.g. lumpsum 1 lakh at 10% for 15 years');
  const fv = money2(amount.value.mul(D(1).plus(rate.div(100)).pow(years.toNumber())));
  const lsSteps = [`FV = P × (1 + r)^t`, `(1 + ${formatNumber(rate)}%)^${formatNumber(years)} = ${formatNumber(D(1).plus(rate.div(100)).pow(years.toNumber()), { maxDecimals: 4 })}`, `FV = ${formatQuantity(amount)} × ${formatNumber(D(1).plus(rate.div(100)).pow(years.toNumber()), { maxDecimals: 4 })} = ${formatQuantity(moneyOrNumber(fv, amount))}`];
  return { ...moneyOrNumber(fv, amount), steps: lsSteps, note: `${formatQuantity(amount)} at ${formatNumber(rate)}% a year compounded yearly for ${yrs(years)} · gain ${formatQuantity(moneyOrNumber(fv.minus(amount.value), amount))}` };
}

/** FD: quarterly compounding; RD: each monthly instalment compounded quarterly for its remaining term (bank method) */
function intentDeposit(p: Parsed, ctx: EvalContext): Quantity | null {
  const fd = p.has('fd');
  const rd = p.has('rd');
  if (!fd && !rd) return null;
  const rate = pcts(p)[0];
  const years = tenureYears(p);
  const amount = nums(p, ctx).find((q, k) => !['years', 'months'].includes(p.words[p.nums[k] + 1]));
  if (!rate || !years || !amount) throw new CalcError(`${fd ? 'FD' : 'RD'} needs amount, rate and term`, fd ? 'e.g. fd 2 lakh at 7.1% for 3 years' : 'e.g. rd 5000 for 2 years at 6.5%');
  const q = rate.div(400);
  let maturity: Decimal;
  let invested: Decimal;
  if (fd) {
    maturity = amount.value.mul(D(1).plus(q).pow(years.mul(4).toNumber()));
    invested = amount.value;
  } else {
    const months = Math.round(years.mul(12).toNumber());
    maturity = D(0);
    for (let k = 1; k <= months; k++) maturity = maturity.plus(amount.value.mul(D(1).plus(q).pow((4 * (months - k + 1)) / 12)));
    invested = amount.value.mul(months);
  }
  maturity = money2(maturity);
  const interest = maturity.minus(invested);
  const fq = (v: Decimal) => formatQuantity(moneyOrNumber(money2(v), amount));
  const depSteps = fd
    ? [`quarterly rate = ${formatNumber(rate)}% ÷ 4 = ${formatNumber(q.mul(100), { maxDecimals: 4 })}%`, `quarters = ${formatNumber(years)} × 4 = ${formatNumber(years.mul(4))}`, `maturity = P × (1 + q)^quarters = ${fq(amount.value)} × ${formatNumber(D(1).plus(q).pow(years.mul(4).toNumber()), { maxDecimals: 4 })} = ${fq(maturity)}`, `interest = ${fq(maturity)} − ${fq(invested)} = ${fq(interest)}`]
    : [`quarterly rate = ${formatNumber(rate)}% ÷ 4 = ${formatNumber(q.mul(100), { maxDecimals: 4 })}%`, `each instalment compounds quarterly for its remaining months (bank method)`, `invested = ${fq(amount.value)} × ${Math.round(years.mul(12).toNumber())} = ${fq(invested)}`, `maturity = ${fq(maturity)}`, `interest = ${fq(maturity)} − ${fq(invested)} = ${fq(interest)}`];
  const tds = interest.gt(40000) ? ` · interest above ₹40,000: bank deducts 10% TDS (₹50,000 for seniors)` : '';
  return { ...moneyOrNumber(maturity, amount), steps: depSteps, note: `${fd ? 'FD' : 'RD'} ${formatQuantity(amount)}${rd ? '/month' : ''} at ${formatNumber(rate)}% for ${yrs(years)}, quarterly compounding · interest ${formatQuantity(moneyOrNumber(interest, amount))} on ${formatQuantity(moneyOrNumber(invested, amount))}${tds}` };
}

/** EMI with a prepayment: same EMI continues, tenure shortens */
function intentPrepay(p: Parsed, ctx: EvalContext): Quantity | null {
  if (!p.has('prepay')) return null;
  const rate = pcts(p)[0];
  const years = tenureYears(p);
  const all = nums(p, ctx);
  const prepayQ = after(p, 'prepay', ctx);
  const principal = all.find((q) => q !== prepayQ && !['years', 'months'].includes(p.words[p.nums[all.indexOf(q)] + 1]));
  if (!rate || !years || !principal || !prepayQ) throw new CalcError('loan, rate, tenure and prepayment?', 'e.g. emi 30 lakh 8.5% 20 years, prepay 2 lakh after 2 years');
  const n = Math.round(years.mul(12).toNumber());
  const r = rate.div(1200);
  const g = D(1).plus(r).pow(n);
  const emi = money2(principal.value.mul(r).mul(g).div(g.minus(1)));
  // "after 2 years": instalments paid before the prepayment
  let afterMonths = 0;
  const ai = p.idx('after');
  if (ai >= 0) {
    const k = p.nums.find((x) => x > ai);
    if (k !== undefined) afterMonths = Math.round(parseFloat(p.words[k]) * (p.words[k + 1] === 'months' ? 1 : 12));
  }
  let bal = principal.value;
  let months = 0;
  let interest = D(0);
  while (bal.gt(0) && months < 1200) {
    months++;
    const int = bal.mul(r);
    interest = interest.plus(int);
    bal = bal.plus(int).minus(emi);
    if (months === afterMonths) bal = bal.minus(prepayQ.value);
    if (bal.lt(0)) bal = D(0);
  }
  const baseInterest = emi.mul(n).minus(principal.value);
  const saved = baseInterest.minus(interest);
  const m = (v: Decimal) => formatQuantity(moneyOrNumber(money2(v), principal));
  return { kind: 'unit', value: D(months).div(12), unit: 'year', display: yrs(D(months).div(12)), note: `EMI ${m(emi)} stays · loan closes ${n - months} months early · interest ${m(interest)} instead of ${m(baseInterest)}, saving ${m(saved)} · prepayment ${m(prepayQ.value)} after ${afterMonths} months` };
}

/** rule of 72 and the exact doubling time */
function intentDoubling(p: Parsed): Quantity | null {
  const rate = pcts(p)[0];
  if (!rate || !(p.has('double') || p.has('72')) || p.nums.length > (p.has('72') ? 1 : 0)) return null;
  if (rate.lte(0)) throw new CalcError('rate must be positive');
  const exact = D(Math.log(2) / Math.log(1 + rate.toNumber() / 100));
  const r72 = D(72).div(rate);
  return { kind: 'unit', value: exact, unit: 'year', display: `${formatNumber(exact, { maxDecimals: 1 })} years`, note: `money doubles at ${formatNumber(rate)}% compounded yearly · rule of 72 says ${formatNumber(r72, { maxDecimals: 1 })} years` };
}

/** "10 lakh today in 10 years at 6% inflation" → future cost; "value of 10 lakh after 10 years at 6% inflation" → purchasing power */
function intentInflation(p: Parsed, ctx: EvalContext): Quantity | null {
  // "10 lakh today in 10 years": an amount projected over years needs a rate; never a bare date
  if (!p.has('inflation') && p.has('today') && (p.has('years') || p.has('year')) && p.pcts.length === 0 && nums(p, ctx).some((q) => q.kind === 'money' || (q.kind === 'number' && q.value.gte(1000)))) {
    throw new CalcError('inflation rate?', 'e.g. 10 lakh today in 10 years at 6% inflation');
  }
  if (!p.has('inflation')) return null;
  const rate = pcts(p)[0];
  const years = tenureYears(p);
  if (!rate) throw new CalcError('inflation rate?', 'e.g. 10 lakh today in 10 years at 6% inflation (India has no fixed official rate here)');
  if (!years) throw new CalcError('how many years?');
  const amount = nums(p, ctx).find((q, k) => !['years', 'months'].includes(p.words[p.nums[k] + 1]));
  if (!amount) throw new CalcError('amount?');
  const f = D(1).plus(rate.div(100)).pow(years.toNumber());
  const power = /\b(value|worth|purchasing|buy|buys)\b/.test(RAW);
  const v = money2(power ? amount.value.div(f) : amount.value.mul(f));
  return { ...moneyOrNumber(v, amount), note: power ? `what ${formatQuantity(amount)} buys after ${yrs(years)} at ${formatNumber(rate)}% inflation` : `${formatQuantity(amount)} today costs this after ${yrs(years)} at ${formatNumber(rate)}% inflation` };
}

/** "rent 25000 with 10 months deposit", "rent 25000 increase 5% for 3 years" */
function intentRent(p: Parsed, ctx: EvalContext): Quantity | null {
  if (!p.has('rent')) return null;
  const rent = after(p, 'rent', ctx);
  if (!rent) return null;
  if (p.has('deposit')) {
    const m = nums(p, ctx).find((q, k) => p.words[p.nums[k] + 1] === 'months');
    if (!m) throw new CalcError('deposit of how many months?', 'e.g. rent 25000 with 10 months deposit');
    const dep = rent.value.mul(m.value);
    return { ...moneyOrNumber(dep, rent), note: `deposit = ${formatQuantity(rent)} × ${formatNumber(m.value)} months · move-in with first rent ${formatQuantity(moneyOrNumber(dep.plus(rent.value), rent))}` };
  }
  const rate = pcts(p)[0];
  const years = tenureYears(p);
  if (rate && years && (p.has('increase') || p.has('hike'))) {
    const v = money2(rent.value.mul(D(1).plus(rate.div(100)).pow(years.toNumber())));
    return { ...moneyOrNumber(v, rent), note: `rent after ${yrs(years)} of ${formatNumber(rate)}% yearly increases` };
  }
  return null;
}

/** "bill 4800, rahul 2 items, priya 1 item" → shares in proportion */
function intentBillShares(p: Parsed, ctx: EvalContext): Quantity | null {
  if (!p.has('bill') || !p.has('items')) return null;
  const bill = after(p, 'bill', ctx);
  if (!bill) return null;
  const shares: { name: string; n: Decimal }[] = [];
  for (const i of p.nums) {
    if (p.words[i + 1] !== 'items') continue;
    const name = p.words[i - 1] && /^[\p{L}]+$/u.test(p.words[i - 1]) && p.words[i - 1] !== 'bill' ? p.words[i - 1] : `person ${shares.length + 1}`;
    shares.push({ name, n: D(p.words[i].replace(/[^\d.]/g, '')) });
  }
  if (shares.length < 2) return null;
  const total = shares.reduce((s, x) => s.plus(x.n), D(0));
  const parts = shares.map((s) => ({ ...s, amt: money2(bill.value.mul(s.n).div(total)) }));
  return { ...bill, display: parts.map((x) => formatQuantity(moneyOrNumber(x.amt, bill))).join(' / '), note: parts.map((x) => `${x.name} ${formatQuantity(moneyOrNumber(x.amt, bill))} (${formatNumber(x.n)} of ${formatNumber(total)} items)`).join(' · ') };
}

// ---------------------------------------------------------------- B. daily life
/** grams per US cup (240 ml), standard kitchen references */
const CUP_GRAMS: Record<string, number> = { flour: 120, maida: 120, atta: 130, sugar: 200, 'brown sugar': 220, rice: 185, chawal: 185, butter: 227, water: 240, milk: 245, oil: 218, oats: 90, salt: 288, honey: 340, dal: 200, besan: 92, ghee: 220, curd: 245, dahi: 245 };

function intentCooking(p: Parsed, ctx: EvalContext): Quantity | null {
  const ing = Object.keys(CUP_GRAMS).find((k) => p.words.join(' ').includes(` ${k} `) || p.words.includes(k));
  if (!ing) return null;
  // "half cup butter": a fraction word stands for the amount
  const frac = p.has('half') ? '0.5' : p.has('quarter') ? '0.25' : null;
  if (p.nums.length !== 1 && !(p.nums.length === 0 && frac)) return null;
  const q = p.nums.length ? numberAt(p, p.nums[0], ctx).q : evalWords([frac!, 'cup'], ctx);
  const u = q.kind === 'unit' ? findUnit(q.unit!) : undefined;
  const wantsCups = p.words.includes('cups') || p.words.includes('cup');
  const perCup = D(CUP_GRAMS[ing]);
  if (u?.id === 'cup' || (u === undefined && wantsCups)) {
    const cups = q.value;
    const target = p.words.find((w) => findUnit(w)?.dim === 'mass') ?? 'g';
    const g = cups.mul(perCup);
    return { ...evalWords([`${g.toString()} g`, 'in', target], ctx), note: `1 cup ${ing} ≈ ${perCup} g (240 ml cup)` };
  }
  if (u?.dim === 'mass' && wantsCups) {
    const grams = evalWords([`${q.value.toString()} ${q.unit}`, 'in', 'g'], ctx).value;
    const cups = grams.div(perCup);
    return { kind: 'unit', value: cups, unit: 'cup', display: `${formatNumber(cups, { maxDecimals: 2 })} cups`, note: `1 cup ${ing} ≈ ${perCup} g (240 ml cup)` };
  }
  return null;
}

/** men's shoe sizes (UK/US/EU) and shirt sizes by chest */
function intentSizes(p: Parsed, ctx: EvalContext): Quantity | null {
  if (p.has('shoe') || ((p.has('uk') || p.has('ussize') || p.has('eu')) && p.nums.length === 1 && p.has('in'))) {
    const n = nums(p, ctx)[0];
    if (!n) throw new CalcError('shoe size?', 'e.g. uk 9 shoe in us');
    const i = p.nums[0];
    const sz = (w: string | undefined) => (w === 'ussize' ? 'us' : w);
    const from = ['uk', 'us', 'eu'].find((s) => sz(p.words[i - 1]) === s || sz(p.words[i + 1]) === s);
    if (!from) throw new CalcError('UK, US or EU size?', 'e.g. uk 9 shoe in us');
    const to = ['uk', 'us', 'eu'].find((s) => s !== from && p.words.some((w) => sz(w) === s)) ?? (from === 'uk' ? 'us' : 'uk');
    const women = p.has('women') || p.has('ladies') || p.has('female');
    let uk = n.value;
    if (from === 'us') uk = n.value.minus(women ? 2 : 1);
    if (from === 'eu') uk = n.value.minus(women ? 33.5 : 33);
    const out = to === 'uk' ? uk : to === 'us' ? uk.plus(women ? 2 : 1) : uk.plus(women ? 33.5 : 33);
    return { kind: 'number', value: out, display: `${to.toUpperCase()} ${formatNumber(out, { maxDecimals: 1 })}`, note: `${women ? "women's" : "men's"} sizes: UK ${formatNumber(uk, { maxDecimals: 1 })} = US ${formatNumber(uk.plus(women ? 2 : 1), { maxDecimals: 1 })} = EU ${formatNumber(uk.plus(women ? 33.5 : 33), { maxDecimals: 1 })} · brands differ by up to half a size` };
  }
  if ((p.has('shirt') && (p.has('size') || p.has('chest'))) || p.has('chest')) {
    const n = nums(p, ctx)[0];
    if (!n) throw new CalcError('chest measurement?', 'e.g. shirt size for 40 inch chest');
    const inch = n.kind === 'unit' ? evalWords([`${n.value.toString()} ${n.unit}`, 'in', 'inch'], ctx).value : n.value;
    const v = inch.toNumber();
    const size = v < 36 ? 'XS' : v < 38 ? 'S' : v < 40 ? 'M' : v < 42 ? 'L' : v < 44 ? 'XL' : v < 46 ? 'XXL' : '3XL';
    return { kind: 'number', value: inch, display: size, note: `chest ${formatNumber(inch, { maxDecimals: 1 })} in · S 36–38, M 38–40, L 40–42, XL 42–44, XXL 44–46 (men's regular fit)` };
  }
  if (p.has('ideal')) {
    const h = nums(p, ctx).find((q) => q.kind === 'unit' && findUnit(q.unit!)?.dim === 'length');
    if (!h) throw new CalcError('height?', 'e.g. ideal weight for 175 cm');
    const inch = evalWords([`${h.value.toString()} ${h.unit}`, 'in', 'inch'], ctx).value;
    const over = Decimal.max(0, inch.minus(60));
    const men = D(50).plus(over.mul(2.3));
    const women = D(45.5).plus(over.mul(2.3));
    const pick = p.has('female') || p.has('women') ? women : men;
    return { kind: 'unit', value: pick, unit: 'kg', display: `${formatNumber(pick, { maxDecimals: 1 })} kg`, note: `Devine formula · men ${formatNumber(men, { maxDecimals: 1 })} kg, women ${formatNumber(women, { maxDecimals: 1 })} kg for ${formatQuantity(h)}` };
  }
  return null;
}

/** "delhi to jaipur at 15 km/l petrol 105", "400 km at 18 kmpl diesel 90" */
function intentFuelCost(p: Parsed, ctx: EvalContext): Quantity | null {
  if (!p.has('petrol') && !p.has('diesel') && !p.has('fuelcost')) return null;
  const economy = p.nums.find((i) => findUnit(p.words[i + 1] ?? '')?.dim === 'fuel');
  if (economy === undefined) return null;
  const price = after(p, 'petrol', ctx) ?? after(p, 'diesel', ctx) ?? after(p, 'fuelcost', ctx);
  if (!price) throw new CalcError('fuel price per litre?', 'e.g. … petrol 105');
  let km: Decimal | null = null;
  const dist = p.nums.find((i) => i !== economy && findUnit(p.words[i + 1] ?? '')?.dim === 'length');
  if (dist !== undefined) km = evalWords([p.words[dist], p.words[dist + 1], 'in', 'km'], ctx).value;
  else {
    const cities = p.words.filter((w) => own(CITIES, w));
    if (cities.length >= 2) km = cityDistanceKm(cities[0], cities[1]);
  }
  if (!km) throw new CalcError('distance?', 'e.g. delhi to jaipur at 15 km/l petrol 105');
  const kmpl = evalWords([p.words[economy], p.words[economy + 1], 'in', 'km/l'], ctx).value;
  const litres = km.div(kmpl);
  const cost = money2(litres.mul(price.value));
  return { ...moneyOrNumber(cost, price), note: `${formatNumber(km, { maxDecimals: 1 })} km ÷ ${formatNumber(kmpl)} km/l = ${formatNumber(litres, { maxDecimals: 2 })} l × ${formatQuantity(price)}/l${dist === undefined ? ' · straight-line distance; by road it is longer' : ''}` };
}

/** "1.5 ton ac 8 hours a day for 30 days at 8 per unit", "1500 watt heater 3 hours daily 30 days at 7 per unit" */
function intentElectricity(p: Parsed, ctx: EvalContext): Quantity | null {
  if (!p.has('perunit') && !p.has('units') && !p.has('items') && !p.has('ac') && !p.has('kwh')) return null;
  let kw: Decimal | null = null;
  const tonI = p.nums.find((i) => p.words[i + 1] === 'ton' || p.words[i + 1] === 'tons');
  const wattI = p.nums.find((i) => ['watt', 'watts', 'w', 'kw', 'kilowatt'].includes(p.words[i + 1] ?? ''));
  if (tonI !== undefined) kw = D(p.words[tonI]).mul(1.2);
  else if (wattI !== undefined) kw = ['kw', 'kilowatt'].includes(p.words[wattI + 1]) ? D(p.words[wattI]) : D(p.words[wattI]).div(1000);
  if (!kw) return null;
  const hours = p.nums.find((i) => p.words[i + 1] === 'hours' || p.words[i + 1] === 'hour');
  const days = p.nums.find((i) => p.words[i + 1] === 'days' || p.words[i + 1] === 'day');
  const h = hours !== undefined ? D(p.words[hours]) : D(1);
  const d = days !== undefined ? D(p.words[days]) : D(1);
  const units = kw.mul(h).mul(d);
  const pu = p.idx('perunit');
  const rateIdx = pu >= 0 ? (p.nums.includes(pu - 1) ? pu - 1 : p.nums.find((i) => i > pu)) : undefined;
  const rate = rateIdx !== undefined ? numberAt(p, rateIdx, ctx).q : null;
  if (!rate) return { kind: 'unit', value: units, unit: 'kWh', display: `${formatNumber(units, { maxDecimals: 2 })} units`, note: `${formatNumber(kw, { maxDecimals: 2 })} kW × ${formatNumber(h)} h × ${formatNumber(d)} days${tonI !== undefined ? ' · 1 ton of AC ≈ 1.2 kW while running' : ''}` };
  const cost = money2(units.mul(rate.value));
  return { ...moneyOrNumber(cost, rate), note: `${formatNumber(units, { maxDecimals: 2 })} units × ${formatQuantity(rate)} · ${formatNumber(kw, { maxDecimals: 2 })} kW × ${formatNumber(h)} h × ${formatNumber(d)} days${tonI !== undefined ? ' · 1 ton of AC ≈ 1.2 kW while running' : ''}` };
}

/** Indian festival and holiday dates (Gregorian), 2026–2028 */
export const FESTIVALS: Record<string, Record<number, string>> = {
  diwali: { 2026: '2026-11-08', 2027: '2027-10-29', 2028: '2028-10-17' },
  holi: { 2026: '2026-03-04', 2027: '2027-03-22', 2028: '2028-03-11' },
  dussehra: { 2026: '2026-10-20', 2027: '2027-10-09', 2028: '2028-09-27' },
  'raksha bandhan': { 2026: '2026-08-28', 2027: '2027-08-17', 2028: '2028-08-05' },
  janmashtami: { 2026: '2026-09-04', 2027: '2027-08-25', 2028: '2028-08-13' },
  'ganesh chaturthi': { 2026: '2026-09-15', 2027: '2027-09-04', 2028: '2028-08-23' },
  'eid ul fitr': { 2026: '2026-03-20', 2027: '2027-03-10', 2028: '2028-02-27' },
  christmas: { 2026: '2026-12-25', 2027: '2027-12-25', 2028: '2028-12-25' },
  'new year': { 2026: '2026-01-01', 2027: '2027-01-01', 2028: '2028-01-01' },
  'independence day': { 2026: '2026-08-15', 2027: '2027-08-15', 2028: '2028-08-15' },
  'republic day': { 2026: '2026-01-26', 2027: '2027-01-26', 2028: '2028-01-26' },
  'gandhi jayanti': { 2026: '2026-10-02', 2027: '2027-10-02', 2028: '2028-10-02' },
};
const FESTIVAL_ALIASES: Record<string, string> = { deepavali: 'diwali', dipawali: 'diwali', 'eid al fitr': 'eid ul fitr', eid: 'eid ul fitr', rakhi: 'raksha bandhan', ganpati: 'ganesh chaturthi', vijayadashami: 'dussehra', 'new years day': 'new year' };

function intentFestival(raw: string, ctx: EvalContext): Quantity | null {
  const text = raw.toLowerCase().replace(/[?.,]/g, ' ').replace(/\s+/g, ' ').trim();
  const names = [...Object.keys(FESTIVALS), ...Object.keys(FESTIVAL_ALIASES)].sort((a, b) => b.length - a.length);
  const name = names.find((n) => new RegExp(`\\b${n}\\b`).test(text));
  if (!name) return null;
  const key = own(FESTIVAL_ALIASES, name) ? FESTIVAL_ALIASES[name] : name;
  const ym = /\b(20\d\d)\b/.exec(text);
  const today = ctx.now().startOf('day');
  let year = ym ? parseInt(ym[1], 10) : today.year;
  let iso = FESTIVALS[key][year];
  if (!ym && iso && DateTime.fromISO(iso, { zone: ctx.zone }) < today) {
    year++;
    iso = FESTIVALS[key][year];
  }
  if (!iso) throw new CalcError(`${key} ${year} is not in the calendar`, 'dates are listed for 2026–2028');
  const d = DateTime.fromISO(iso, { zone: ctx.zone });
  const days = Math.round(d.diff(today, 'days').days);
  const note = `${key} ${year} · dates per the Indian national calendar; confirm locally for regional variations`;
  if (/\b(days|din|how long|kitne din|till|until|tak|left|baki|countdown)\b/.test(text)) {
    return { kind: 'unit', value: D(days), unit: 'day', note: `${d.toFormat('ccc, d LLL yyyy')} · ${note}` };
  }
  return { kind: 'date', value: D(d.toMillis()), date: d, display: d.toFormat('ccc, d LLL yyyy'), note: `${days >= 0 ? `in ${days} days` : `${-days} days ago`} · ${note}` };
}

/** "next birthday if born 15 aug 1990", "week number of 15 nov 2026" */
function intentBirthdayWeek(p: Parsed, ctx: EvalContext, raw: string): Quantity | null {
  const today = ctx.now().startOf('day');
  if (p.has('birthday')) {
    const m = /(\d{1,2})\s+([a-z]{3,9})(?:\s+(\d{4}))?/i.exec(raw.toLowerCase().split(/born|birthday/).pop() ?? '');
    if (!m) throw new CalcError('birth date?', 'e.g. next birthday if born 15 aug 1990');
    const probe = DateTime.fromFormat(`${m[1]} ${m[2].slice(0, 3)} ${today.year}`, 'd LLL yyyy', { zone: ctx.zone });
    if (!probe.isValid) throw new CalcError('birth date?', 'e.g. next birthday if born 15 aug 1990');
    const next = probe < today ? probe.plus({ years: 1 }) : probe;
    const days = Math.round(next.diff(today, 'days').days);
    const age = m[3] ? next.year - parseInt(m[3], 10) : null;
    return { kind: 'date', value: D(next.toMillis()), date: next, display: next.toFormat('ccc, d LLL yyyy'), note: `${days === 0 ? 'today!' : `in ${days} days`}${age ? ` · turning ${age}` : ''}` };
  }
  if (p.has('weeknum')) {
    const dm = /(\d{1,2})\s+([a-z]{3,9})\s+(\d{4})/i.exec(raw.toLowerCase());
    const d = dm ? DateTime.fromFormat(`${dm[1]} ${dm[2].slice(0, 3)} ${dm[3]}`, 'd LLL yyyy', { zone: ctx.zone }) : today;
    if (!d.isValid) throw new CalcError('which date?', 'e.g. week number of 15 nov 2026');
    return { kind: 'number', value: D(d.weekNumber), display: `week ${d.weekNumber}`, note: `ISO week of ${d.toFormat('ccc, d LLL yyyy')} · week ${d.weekNumber} of ${d.weeksInWeekYear}` };
  }
  return null;
}

/** "9:30 to 18:45 minus 45 min, 22 days" → monthly hours; "time left until 5pm" */
function intentShift(p: Parsed, ctx: EvalContext, spanOf: (words: string[]) => Quantity | null): Quantity | null {
  const dayI = p.nums.find((i) => p.words[i + 1] === 'days');
  if (dayI !== undefined && p.words.some((w) => /^\d{1,2}:\d{2}(am|pm)?$|^\d{1,2}(am|pm)$/.test(w)) && p.has('to')) {
    const words = p.words.filter((_, i) => i !== dayI && i !== dayI + 1 && p.words[i] !== ',');
    const span = spanOf(words);
    if (!span) return null;
    const days = D(p.words[dayI]);
    const hours = span.value.mul(days);
    return { kind: 'unit', value: hours, unit: 'h', display: `${formatNumber(hours, { maxDecimals: 2 })} h`, note: `${span.display ?? formatQuantity(span)} a day × ${formatNumber(days)} days${span.note ? ` · ${span.note}` : ''}` };
  }
  if (p.has('remaining') && p.has('time') && p.nums.length === 0) {
    const t = p.words.find((w) => /^\d{1,2}(:\d{2})?(am|pm)$/.test(w));
    if (!t) return null;
    const target = evalWords([t], ctx);
    const now = ctx.now();
    let end = target.date!;
    if (end <= now) end = end.plus({ days: 1 });
    const minutes = Math.round(end.diff(now, 'minutes').minutes);
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return { kind: 'unit', value: D(minutes).div(60), unit: 'h', display: m ? `${h} h ${m} min` : `${h} h`, note: `from ${now.toFormat('h:mm a')} to ${end.toFormat('h:mm a')}` };
  }
  return null;
}

/** "5 kg at 450 vs 2 kg at 190" → price per unit, cheaper one */
function intentCompare(p: Parsed, ctx: EvalContext): Quantity | null {
  if (!p.has('vs') && !p.has('cheaper') && !p.has('versus')) return null;
  const offers: { qty: Quantity; price: Quantity }[] = [];
  for (let k = 0; k + 1 < p.nums.length; k++) {
    const a = numberAt(p, p.nums[k], ctx).q;
    const b = numberAt(p, p.nums[k + 1], ctx).q;
    if (a.kind === 'unit' && b.kind !== 'unit') {
      offers.push({ qty: a, price: b });
      k++;
    }
  }
  if (offers.length < 2) return null;
  const base = findUnit(offers[0].qty.unit!)!;
  const rates = offers.map((o) => {
    const q = evalWords([`${o.qty.value.toString()} ${o.qty.unit}`, 'in', base.id], ctx).value;
    return { ...o, per: o.price.value.div(q) };
  });
  const best = rates.reduce((m, r) => (r.per.lt(m.per) ? r : m));
  const fmt = (r: (typeof rates)[number]) => `${formatQuantity(r.qty)} at ${formatQuantity(r.price)} = ${formatQuantity(moneyOrNumber(money2(r.per), r.price))}/${base.symbol}`;
  return { ...moneyOrNumber(money2(best.per), best.price), display: `${formatQuantity(best.qty)} at ${formatQuantity(best.price)} is cheaper`, note: rates.map(fmt).join(' · ') };
}

// ---------------------------------------------------------------- numbers: words, roman, bases
const ONES = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
function below1000(n: number): string {
  const parts: string[] = [];
  if (n >= 100) {
    parts.push(`${ONES[Math.floor(n / 100)]} hundred`);
    n %= 100;
  }
  if (n >= 20) parts.push(TENS[Math.floor(n / 10)] + (n % 10 ? `-${ONES[n % 10]}` : ''));
  else if (n > 0) parts.push(ONES[n]);
  return parts.join(' ');
}
export function numberToWords(n: Decimal, indian: boolean): string {
  if (n.isZero()) return 'zero';
  const neg = n.isNegative();
  const whole = n.abs().floor();
  const frac = n.abs().minus(whole);
  const out: string[] = [];
  let v = whole;
  if (indian) {
    const scales: [Decimal, string][] = [[D(10000000), 'crore'], [D(100000), 'lakh'], [D(1000), 'thousand']];
    for (const [s, name] of scales) {
      if (v.gte(s)) {
        const q = v.div(s).floor();
        out.push(`${numberToWords(q, true)} ${name}`);
        v = v.minus(q.mul(s));
      }
    }
  } else {
    const scales: [Decimal, string][] = [[D('1e12'), 'trillion'], [D('1e9'), 'billion'], [D('1e6'), 'million'], [D(1000), 'thousand']];
    for (const [s, name] of scales) {
      if (v.gte(s)) {
        const q = v.div(s).floor();
        out.push(`${below1000(q.toNumber())} ${name}`);
        v = v.minus(q.mul(s));
      }
    }
  }
  if (v.gt(0)) out.push(below1000(v.toNumber()));
  let text = out.join(' ');
  if (frac.gt(0)) text += ` point ${frac.toFixed(2).slice(2).split('').map((c) => (c === '0' ? 'zero' : ONES[parseInt(c, 10)])).join(' ')}`;
  return (neg ? 'minus ' : '') + text;
}

const ROMAN: [number, string][] = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
export function toRoman(n: number): string {
  if (!Number.isInteger(n) || n <= 0 || n >= 4000) throw new CalcError('roman numerals cover 1 to 3999');
  let s = '';
  for (const [v, r] of ROMAN) while (n >= v) {
    s += r;
    n -= v;
  }
  return s;
}
export function fromRoman(s: string): number | null {
  const map: Record<string, number> = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };
  const up = s.toUpperCase();
  if (!/^[IVXLCDM]+$/.test(up)) return null;
  let total = 0;
  for (let i = 0; i < up.length; i++) {
    const v = map[up[i]];
    const next = map[up[i + 1]] ?? 0;
    total += v < next ? -v : v;
  }
  return toRoman(total) === up ? total : null;
}

function intentNumberForms(p: Parsed, ctx: EvalContext, raw: string): Quantity | null {
  const text = raw.toLowerCase();
  const rm = /\broman\s+([ivxlcdm]+)\b/i.exec(raw) ?? /^\s*([ivxlcdm]{2,})\s+(?:in|to)\s+(?:number|decimal|digits?)\s*$/i.exec(raw);
  if (rm) {
    const v = fromRoman(rm[1]);
    if (v === null) throw new CalcError(`${rm[1].toUpperCase()} is not a valid roman numeral`);
    return { kind: 'number', value: D(v), display: String(v), note: `${rm[1].toUpperCase()} in roman numerals` };
  }
  if (p.nums.length !== 1) return null;
  const q = numberAt(p, p.nums[0], ctx).q;
  if (/\bin words\b|\bwords me\b|\bspell\b/.test(text)) {
    const intl = /\binternational\b|\bmillion\b|\bwestern\b/.test(text);
    const w = numberToWords(q.value, !intl);
    return { ...q, display: w, note: `${formatQuantity(q)} · ${intl ? 'international' : 'Indian'} system${intl ? '' : `; international: ${numberToWords(q.value, false)}`}` };
  }
  if (/\bin roman\b/.test(text)) return { ...q, display: toRoman(q.value.toNumber()), note: `${formatQuantity(q)} in roman numerals` };
  if (/\bin hex\b|\bin hexadecimal\b/.test(text)) {
    if (!q.value.isInteger() || q.value.isNegative()) throw new CalcError('hex needs a whole number');
    return { ...q, display: `0x${q.value.toHexadecimal().slice(2).toUpperCase()}`, note: `${formatQuantity(q)} in hexadecimal` };
  }
  if (/\bin binary\b/.test(text)) {
    if (!q.value.isInteger() || q.value.isNegative()) throw new CalcError('binary needs a whole number');
    return { ...q, display: `0b${q.value.toBinary().slice(2)}`, note: `${formatQuantity(q)} in binary` };
  }
  if (/\bin octal\b/.test(text)) {
    if (!q.value.isInteger() || q.value.isNegative()) throw new CalcError('octal needs a whole number');
    return { ...q, display: `0o${q.value.toOctal().slice(2)}`, note: `${formatQuantity(q)} in octal` };
  }
  return null;
}

// ---------------------------------------------------------------- C. health and study
function intentHealth(p: Parsed, ctx: EvalContext): Quantity | null {
  if (p.has('bmr') || p.has('tdee')) {
    const mass = nums(p, ctx).find((q) => q.kind === 'unit' && findUnit(q.unit!)?.dim === 'mass');
    const height = nums(p, ctx).find((q) => q.kind === 'unit' && findUnit(q.unit!)?.dim === 'length');
    const age = p.nums.map((i) => ({ i, w: p.words[i + 1] })).find((x) => x.w === 'years' || x.w === 'year' || x.w === 'saal' || (!findUnit(x.w ?? '') && !PCT_RE.test(p.words[x.i])));
    const female = p.has('female') || p.has('women') || p.has('woman') || p.has('girl') || p.has('mahila');
    const level = (['very', 'sedentary', 'light', 'moderate', 'active'] as const).find((l) => p.has(l));
    const mult: Record<string, number> = { sedentary: 1.2, light: 1.375, moderate: 1.55, active: 1.725, very: 1.9 };
    let bmr: Decimal;
    if (mass && height && age) {
      const kg = evalWords([`${mass.value.toString()} ${mass.unit}`, 'in', 'kg'], ctx).value;
      const cm = evalWords([`${height.value.toString()} ${height.unit}`, 'in', 'cm'], ctx).value;
      const a = D(p.words[age.i].replace(/[^\d.]/g, ''));
      bmr = D(10).mul(kg).plus(D(6.25).mul(cm)).minus(D(5).mul(a)).plus(female ? -161 : 5);
    } else if (p.has('tdee') && nums(p, ctx).length === 1 && nums(p, ctx)[0].kind === 'number') bmr = nums(p, ctx)[0].value;
    else throw new CalcError('weight, height and age?', 'e.g. bmr 70 kg 175 cm 30 male');
    if (p.has('tdee')) {
      const l = level ?? 'moderate';
      const tdee = bmr.mul(mult[l]);
      return { kind: 'number', value: tdee.toDecimalPlaces(0), display: `${formatNumber(tdee.toDecimalPlaces(0))} kcal/day`, note: `TDEE = BMR ${formatNumber(bmr.toDecimalPlaces(0))} × ${mult[l]} (${l === 'very' ? 'very active' : l})${level ? '' : ' assumed'} · Mifflin-St Jeor` };
    }
    return { kind: 'number', value: bmr.toDecimalPlaces(0), display: `${formatNumber(bmr.toDecimalPlaces(0))} kcal/day`, note: `BMR, Mifflin-St Jeor (${female ? 'female' : 'male'}) · TDEE ≈ ×1.2 sedentary, ×1.55 moderate, ×1.9 very active` };
  }
  if (p.has('calories') && p.has('lose')) {
    const m = nums(p, ctx).find((q) => q.kind === 'unit' && findUnit(q.unit!)?.dim === 'mass');
    if (!m) throw new CalcError('how much weight?', 'e.g. calories to lose 0.5 kg a week');
    const kg = evalWords([`${m.value.toString()} ${m.unit}`, 'in', 'kg'], ctx).value;
    const perWeek = p.has('week') || p.has('weeks') || p.has('weekly');
    const daily = kg.mul(7700).div(perWeek ? 7 : 1);
    return { kind: 'number', value: daily.toDecimalPlaces(0), display: `${formatNumber(daily.toDecimalPlaces(0))} kcal/day deficit`, note: `1 kg of fat ≈ 7,700 kcal · ${formatQuantity(m)} ${perWeek ? 'a week' : 'total per day'}` };
  }
  if (/\bwater\b/.test(RAW) && /\b(intake|drink|peena|pina|daily|per day|roz|kitna|should)\b/.test(RAW)) {
    const m = nums(p, ctx).find((q) => q.kind === 'unit' && findUnit(q.unit!)?.dim === 'mass');
    if (!m) throw new CalcError('body weight?', 'e.g. water intake 70 kg');
    const kg = evalWords([`${m.value.toString()} ${m.unit}`, 'in', 'kg'], ctx).value;
    const l = kg.mul(35).div(1000);
    return { kind: 'unit', value: l, unit: 'l', display: `${formatNumber(l, { maxDecimals: 2 })} l/day`, note: `35 ml per kg of body weight, a common guideline; more in heat or exercise` };
  }
  if (p.has('steps')) {
    const n = nums(p, ctx).find((q) => q.kind === 'number');
    if (!n) return null;
    const km = n.value.mul(0.762).div(1000);
    return { ...evalWords([`${km.toString()} km`, 'in', p.words.includes('miles') ? 'miles' : 'km'], ctx), note: `${formatQuantity(n)} steps × 0.762 m average stride · about ${formatNumber(n.value.mul(0.04).toDecimalPlaces(0))} kcal` };
  }
  if (p.has('pace')) {
    const dist = nums(p, ctx).find((q) => q.kind === 'unit' && findUnit(q.unit!)?.dim === 'length');
    const timeWord = p.words.find((w) => /^\d{1,2}:\d{2}$/.test(w));
    const mins = nums(p, ctx).find((q, k) => p.words[p.nums[k] + 1] === 'minutes');
    if (dist && (mins || timeWord)) {
      const km = evalWords([`${dist.value.toString()} ${dist.unit}`, 'in', 'km'], ctx).value;
      const minutes = timeWord ? D(timeWord.split(':')[0]).plus(D(timeWord.split(':')[1]).div(60)) : mins!.value;
      if (timeWord) {
        // "pace 5:30 for 10 km" → total time
        const total = minutes.mul(km);
        const h = Math.floor(total.toNumber() / 60);
        const m = total.minus(h * 60).toDecimalPlaces(0).toNumber();
        return { kind: 'unit', value: total.div(60), unit: 'h', display: h ? `${h} h ${m} min` : `${m} min`, note: `${timeWord} min/km × ${formatNumber(km)} km` };
      }
      const per = minutes.div(km);
      const mm = Math.floor(per.toNumber());
      const ss = Math.round((per.toNumber() - mm) * 60);
      return { kind: 'number', value: per, display: `${mm}:${String(ss).padStart(2, '0')} min/km`, note: `${formatNumber(minutes)} min ÷ ${formatNumber(km)} km · ${formatNumber(km.div(minutes).mul(60), { maxDecimals: 2 })} km/h` };
    }
  }
  return null;
}

const GRADES: [number, string][] = [[91, 'A1'], [81, 'A2'], [71, 'B1'], [61, 'B2'], [51, 'C1'], [41, 'C2'], [33, 'D'], [0, 'E']];
function intentStudy(p: Parsed, ctx: EvalContext): Quantity | null {
  if (p.has('grade')) {
    const pc = pcts(p)[0] ?? nums(p, ctx)[0]?.value;
    if (!pc) throw new CalcError('percentage?', 'e.g. grade for 86%');
    const g = GRADES.find(([min]) => pc.gte(min))!;
    return { kind: 'percent', value: pc, display: g[1], note: `${formatNumber(pc)}% · CBSE scale: A1 91–100, A2 81–90, B1 71–80, B2 61–70, C1 51–60, C2 41–50, D 33–40` };
  }
  // "average of 78 82 91 then what for 85 average", "marks needed for 85 average with 78, 82, 91"
  if (p.has('average') && p.has('what') && p.nums.length >= 2) {
    const all = nums(p, ctx).map((q) => q.value);
    const ti = p.nums.findIndex((i) => p.words[i - 1] === 'for' || p.words[i + 1] === 'average' || p.words[i - 1] === 'target');
    const target = ti >= 0 ? all[ti] : all[all.length - 1];
    const have = all.filter((_, k) => k !== (ti >= 0 ? ti : all.length - 1));
    const need = target.mul(have.length + 1).minus(have.reduce((s, x) => s.plus(x), D(0)));
    return { kind: 'number', value: need, note: `${formatNumber(target)} average over ${have.length + 1} · have ${have.map((x) => formatNumber(x)).join(', ')} (sum ${formatNumber(have.reduce((s, x) => s.plus(x), D(0)))})${need.gt(100) ? ' · more than 100: not reachable' : ''}` };
  }
  return null;
}

/** "12 workers 8 days, 16 workers how many days" (inverse); "5 pens cost 60, 8 pens?" (direct); train crossing a platform */
function intentProportion(p: Parsed, ctx: EvalContext): Quantity | null {
  if (p.has('train') && p.has('platform')) {
    const lens = nums(p, ctx).filter((q) => q.kind === 'unit' && findUnit(q.unit!)?.dim === 'length');
    const speed = nums(p, ctx).find((q) => q.kind === 'unit' && findUnit(q.unit!)?.dim === 'speed');
    if (lens.length < 2 || !speed) throw new CalcError('train length, platform length and speed?', 'e.g. train 300 m at 72 km/h crosses platform 200 m');
    const m = lens.reduce((s, q) => s.plus(evalWords([`${q.value.toString()} ${q.unit}`, 'in', 'm'], ctx).value), D(0));
    const mps = evalWords([`${speed.value.toString()} ${speed.unit}`, 'in', 'm/s'], ctx).value;
    const s = m.div(mps);
    return { kind: 'unit', value: s, unit: 's', note: `(${lens.map((q) => formatQuantity(q)).join(' + ')}) ÷ ${formatNumber(mps, { maxDecimals: 2 })} m/s` };
  }
  if (p.nums.length !== 3) return null;
  // "5 pens cost 60, 8 pens?": the last amount with its label ends the question
  const lastIsQuestion = p.has('what') || /\?\s*$/.test(RAW) || p.nums[2] + 2 >= p.words.length;
  if (!lastIsQuestion) return null;
  const labels = p.nums.map((i) => (p.words[i + 1] && /^[\p{L}]+$/u.test(p.words[i + 1]) && p.words[i + 1] !== 'what' ? p.words[i + 1] : ''));
  // a b, c ? : a of label L1 with b of L2, c of L1 → ?
  if (labels[0] && labels[0] === labels[2] && labels[1] !== labels[0]) {
    const [a, b, c] = nums(p, ctx).map((q) => q.value);
    const inverse = p.has('workers') || p.has('people') || p.has('men') || p.has('machines') || p.has('pipes') || p.has('inverse');
    const v = inverse ? a.mul(b).div(c) : b.mul(c).div(a);
    return { kind: 'number', value: v, display: `${formatNumber(v, { maxDecimals: 2 })}${labels[1] ? ' ' + labels[1] : ''}`, note: inverse ? `inverse proportion: ${formatNumber(a)} ${labels[0]} × ${formatNumber(b)} ${labels[1]} = ${formatNumber(c)} ${labels[0]} × ?` : `direct proportion: ${formatNumber(b)} ${labels[1]} ÷ ${formatNumber(a)} ${labels[0]} × ${formatNumber(c)} ${labels[0]}` };
  }
  return null;
}

// ---------------------------------------------------------------- D. equations, statistics
/** "2x + 5 = 17", "x% of 80 = 20": linear in x, solved by two evaluations */
export function intentEquation(raw: string, ctx: EvalContext): Quantity | null {
  const m = /^\s*(.+?)\s*=\s*(.+?)\s*$/.exec(raw);
  if (!m || !/(^|[^a-z])x([^a-z]|$)/i.test(raw) || /[<>]/.test(raw)) return null;
  const prep = (s: string) => s.toLowerCase().replace(/(\d)\s*x\b/g, '$1 * x').replace(/\bx\s*(\d)/g, 'x * $1').replace(/\bx%/g, '(x)%');
  const at = (side: string, x: number): Decimal => {
    const vars = new Map(ctx.variables);
    vars.set('x', { kind: 'number', value: D(x) });
    const q = evalWords([prep(side).replace(/\(x\)%/g, `(${x})%`)], { ...ctx, variables: vars });
    return q.value;
  };
  const f = (x: number) => at(m[1], x).minus(at(m[2], x));
  const f0 = f(0);
  const f1 = f(1);
  const f2 = f(2);
  const slope = f1.minus(f0);
  if (!f2.minus(f1).minus(slope).abs().lt('1e-9')) throw new CalcError('only linear equations in x', 'e.g. 2x + 5 = 17');
  if (slope.isZero()) throw new CalcError(f0.isZero() ? 'true for every x' : 'no solution');
  const x = f0.neg().div(slope);
  return { kind: 'number', value: x, display: `x = ${formatNumber(x)}`, note: `${raw.trim()} · check: ${formatNumber(at(m[1], x.toNumber()))} = ${formatNumber(at(m[2], x.toNumber()))}` };
}

function intentStats(p: Parsed, ctx: EvalContext): Quantity | null {
  const fn = (['std', 'variance', 'range', 'percentile'] as const).find((f) => p.has(f));
  if (!fn || p.nums.length < 2) return null;
  let values = nums(p, ctx).map((q) => q.value);
  let pct: Decimal | null = null;
  if (fn === 'percentile') {
    const pi = p.words.findIndex((w) => /^\d+(st|nd|rd|th)?$/.test(w) && p.words[p.words.indexOf(w) + 1] === 'percentile');
    pct = pi >= 0 ? D(p.words[pi].replace(/\D/g, '')) : null;
    if (!pct) throw new CalcError('which percentile?', 'e.g. 90th percentile of 10, 20, 30');
    values = values.filter((_, k) => p.nums[k] !== pi);
  }
  const n = values.length;
  const mean = values.reduce((s, x) => s.plus(x), D(0)).div(n);
  const sorted = [...values].sort((a, b) => a.cmp(b));
  if (fn === 'range') return { kind: 'number', value: sorted[n - 1].minus(sorted[0]), note: `max ${formatNumber(sorted[n - 1])} − min ${formatNumber(sorted[0])}` };
  if (fn === 'percentile') {
    const rank = Math.max(1, Math.ceil(pct!.toNumber() / 100 * n));
    return { kind: 'number', value: sorted[rank - 1], note: `${formatNumber(pct!)}th percentile, nearest rank ${rank} of ${n}` };
  }
  const ssq = values.reduce((s, x) => s.plus(x.minus(mean).pow(2)), D(0));
  const popVar = ssq.div(n);
  const sampleVar = n > 1 ? ssq.div(n - 1) : D(0);
  if (fn === 'variance') return { kind: 'number', value: popVar.toDecimalPlaces(4), note: `population variance · sample variance ${formatNumber(sampleVar)} · mean ${formatNumber(mean)}` };
  return { kind: 'number', value: popVar.sqrt().toDecimalPlaces(4), note: `population standard deviation · sample ${formatNumber(sampleVar.sqrt())} · mean ${formatNumber(mean)}` };
}

/** "x = 1 to 12" lists; the range form of other lines ("emi 5 lakh at 9% for 1 to 5 years") is expanded by index.ts */
export function intentRangeList(raw: string): Quantity | null {
  const m = /^\s*([a-z]\w*)\s*=\s*(-?\d+)\s+to\s+(-?\d+)(?:\s+step\s+(\d+))?\s*$/i.exec(raw);
  if (!m) return null;
  const [a, b, step] = [parseInt(m[2], 10), parseInt(m[3], 10), m[4] ? parseInt(m[4], 10) : 1];
  const items: number[] = [];
  for (let v = a; (a <= b ? v <= b : v >= b) && items.length < 100; v += a <= b ? step : -step) items.push(v);
  return { kind: 'number', value: D(items.length), display: items.join(', '), note: `${items.length} values of ${m[1]}` };
}

export function extraIntents(raw: string, p: Parsed, ctx: EvalContext, spanOf: (words: string[]) => Quantity | null): Quantity | null {
  RAW = raw.toLowerCase();
  return (
    intentEquation(raw, ctx) ??
    intentRangeList(raw) ??
    intentFestival(raw, ctx) ??
    intentNumberForms(p, ctx, raw) ??
    intentIncomeTax(p, ctx) ??
    intentInHand(p, ctx) ??
    intentSip(p, ctx) ??
    intentLumpsum(p, ctx) ??
    intentDeposit(p, ctx) ??
    intentPrepay(p, ctx) ??
    intentDoubling(p) ??
    intentInflation(p, ctx) ??
    intentRent(p, ctx) ??
    intentBillShares(p, ctx) ??
    intentCooking(p, ctx) ??
    intentSizes(p, ctx) ??
    intentFuelCost(p, ctx) ??
    intentElectricity(p, ctx) ??
    intentBirthdayWeek(p, ctx, raw) ??
    intentShift(p, ctx, spanOf) ??
    intentCompare(p, ctx) ??
    intentHealth(p, ctx) ??
    intentStudy(p, ctx) ??
    intentProportion(p, ctx) ??
    intentStats(p, ctx)
  );
}

export { analyse as analyseWords };
