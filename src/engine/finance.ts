import { Decimal } from './types';

/**
 * Deterministic finance formulas. All inputs are Decimals; rates are percentages (18 = 18%).
 * Rounding: money results are rounded HALF_UP to 2 decimals by `money2`; percentages to 2 decimals by `pct2`.
 */
export const money2 = (d: Decimal): Decimal => d.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
export const pct2 = (d: Decimal): Decimal => d.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

const ONE = new Decimal(1);
const HUNDRED = new Decimal(100);

export function gstAdd(base: Decimal, rate: Decimal): { total: Decimal; tax: Decimal } {
  const tax = money2(base.mul(rate).div(HUNDRED));
  return { tax, total: money2(base.plus(tax)) };
}

/** Reverse GST: the given amount is inclusive of GST at `rate`. */
export function gstRemove(total: Decimal, rate: Decimal): { base: Decimal; tax: Decimal } {
  const base = money2(total.div(ONE.plus(rate.div(HUNDRED))));
  return { base, tax: money2(total.minus(base)) };
}

export function discount(price: Decimal, rate: Decimal): { final: Decimal; saved: Decimal } {
  const saved = money2(price.mul(rate).div(HUNDRED));
  return { saved, final: money2(price.minus(saved)) };
}

export function percentChange(from: Decimal, to: Decimal): Decimal {
  if (from.isZero()) return new Decimal(NaN);
  return pct2(to.minus(from).div(from).mul(HUNDRED));
}

export function profitLoss(cost: Decimal, sell: Decimal): { amount: Decimal; pct: Decimal } {
  const amount = money2(sell.minus(cost));
  const pct = cost.isZero() ? new Decimal(NaN) : pct2(amount.div(cost).mul(HUNDRED));
  return { amount, pct };
}

/** markup: profit as % of cost → price */
export function priceFromMarkup(cost: Decimal, markupPct: Decimal): Decimal {
  return money2(cost.mul(ONE.plus(markupPct.div(HUNDRED))));
}
/** margin: profit as % of selling price → price */
export function priceFromMargin(cost: Decimal, marginPct: Decimal): Decimal {
  if (marginPct.gte(100)) return new Decimal(NaN);
  return money2(cost.div(ONE.minus(marginPct.div(HUNDRED))));
}
export function markupPct(cost: Decimal, price: Decimal): Decimal {
  return cost.isZero() ? new Decimal(NaN) : pct2(price.minus(cost).div(cost).mul(HUNDRED));
}
export function marginPct(cost: Decimal, price: Decimal): Decimal {
  return price.isZero() ? new Decimal(NaN) : pct2(price.minus(cost).div(price).mul(HUNDRED));
}
export function marginToMarkup(marginPct: Decimal): Decimal {
  return pct2(marginPct.div(HUNDRED.minus(marginPct)).mul(HUNDRED));
}
export function markupToMargin(markupPct: Decimal): Decimal {
  return pct2(markupPct.div(HUNDRED.plus(markupPct)).mul(HUNDRED));
}

/**
 * EMI with monthly compounding (reducing balance), the standard Indian bank formula:
 * EMI = P·r·(1+r)^n / ((1+r)^n − 1), r = annual% / 12 / 100.
 */
export function emi(principal: Decimal, annualRatePct: Decimal, months: number): { emi: Decimal; totalPayment: Decimal; totalInterest: Decimal } {
  if (months <= 0) return { emi: new Decimal(NaN), totalPayment: new Decimal(NaN), totalInterest: new Decimal(NaN) };
  const r = annualRatePct.div(1200);
  let e: Decimal;
  if (r.isZero()) e = principal.div(months);
  else {
    const f = ONE.plus(r).pow(months);
    e = principal.mul(r).mul(f).div(f.minus(ONE));
  }
  const emiR = money2(e);
  const totalPayment = money2(emiR.mul(months));
  return { emi: emiR, totalPayment, totalInterest: money2(totalPayment.minus(principal)) };
}

export function simpleInterest(principal: Decimal, ratePct: Decimal, years: Decimal): { interest: Decimal; total: Decimal } {
  const interest = money2(principal.mul(ratePct).mul(years).div(HUNDRED));
  return { interest, total: money2(principal.plus(interest)) };
}

export type Compounding = 'yearly' | 'half-yearly' | 'quarterly' | 'monthly' | 'daily';
const PERIODS: Record<Compounding, number> = { yearly: 1, 'half-yearly': 2, quarterly: 4, monthly: 12, daily: 365 };

export function compoundInterest(principal: Decimal, ratePct: Decimal, years: Decimal, compounding: Compounding = 'yearly'): { interest: Decimal; total: Decimal } {
  const n = PERIODS[compounding];
  const total = money2(principal.mul(ONE.plus(ratePct.div(HUNDRED).div(n)).pow(years.mul(n))));
  return { total, interest: money2(total.minus(principal)) };
}
