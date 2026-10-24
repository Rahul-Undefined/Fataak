/**
 * Indian tax and finance rules FATAAK calculates with. Everything year-specific lives here, dated, with the source
 * it was checked against. docs/RULES.md describes the weekly review that updates this file; the app shows
 * `RULES.asOf` in Settings so a user can see how current the figures are.
 *
 * Amounts are rupees per year unless stated. Slabs are [upper limit, rate %] pairs from zero upwards.
 */
export interface RegimeYear {
  label: string;
  slabs: [number, number][];
  /** 87A: no tax when taxable income is at or below this (with marginal relief just above it) */
  rebate: number;
  /** standard deduction for salary and pension */
  stdDed: number;
}

export const RULES = {
  /** the date these figures were last checked against the sources below (ISO) */
  asOf: '2026-10-24',
  sources: [
    'Income Tax Department: incometaxindia.gov.in (Finance Act 2025, rates for FY 2025-26 / AY 2026-27)',
    'CBDT circulars on TDS thresholds (Budget 2025)',
    'GST Council: gstcouncil.gov.in (rate rationalisation effective 22 Sep 2025)',
    'EPFO: epfindia.gov.in (contribution rates, interest rate)',
    'Ministry of Finance small savings rates (PPF)',
    'ESIC: esic.gov.in (contribution rates, wage ceiling)',
  ],
  incomeTax: {
    /** the financial year used when none is named */
    defaultFy: 2025,
    newRegime: {
      2023: { label: 'FY 2023-24', slabs: [[300000, 0], [600000, 5], [900000, 10], [1200000, 15], [1500000, 20], [Infinity, 30]], rebate: 700000, stdDed: 50000 },
      2024: { label: 'FY 2024-25', slabs: [[300000, 0], [700000, 5], [1000000, 10], [1200000, 15], [1500000, 20], [Infinity, 30]], rebate: 700000, stdDed: 75000 },
      2025: { label: 'FY 2025-26', slabs: [[400000, 0], [800000, 5], [1200000, 10], [1600000, 15], [2000000, 20], [2400000, 25], [Infinity, 30]], rebate: 1200000, stdDed: 75000 },
    } as Record<number, RegimeYear>,
    oldRegime: { slabs: [[250000, 0], [500000, 5], [1000000, 20], [Infinity, 30]] as [number, number][], rebate: 500000, stdDed: 50000 },
    /** surcharge bands on total income: [above, rate %]; the new regime caps at 25%, the old regime goes to 37% */
    surcharge: [[5000000, 10], [10000000, 15], [20000000, 25], [50000000, 37]] as [number, number][],
    surchargeCapNewRegime: 25,
    cessPct: 4,
    deductions: { '80c': 150000, '80d': 25000, '80dSenior': 50000, '80ccd1b': 50000 },
    /** TDS on bank/post-office interest, per year */
    tdsInterest: { general: 50000, senior: 100000 },
    /** TDS on rent under 194-I, per year */
    tdsRent: 600000,
    professionalTaxMax: 2500,
    gratuityTaxFree: 2000000,
    capitalGains: { ltcgEquityPct: 12.5, ltcgEquityExempt: 125000, stcgEquityPct: 20, since: '23 Jul 2024' },
    seniorAge: 60,
    superSeniorAge: 80,
  },
  gst: {
    slabs: '5% and 18% (since 22 Sep 2025); 40% on a few luxury and sin goods; 0% on essentials',
    before: 'before 22 Sep 2025 the slabs were 5%, 12%, 18% and 28%',
  },
  pf: { employeePct: 12, employerPct: 12, epsPct: 8.33, epsWageCeiling: 15000, interestPct: 8.25, interestYear: 'FY 2024-25' },
  ppf: { interestPct: 7.1, yearlyLimit: 150000, termYears: 15 },
  esi: { employeePct: 0.75, employerPct: 3.25, wageCeiling: 21000 },
  depositInsurance: 500000,
  cashReceiptLimit: 200000,
};

export const DEFAULT_FY = RULES.incomeTax.defaultFy;
export const FY_LABEL = RULES.incomeTax.newRegime[DEFAULT_FY].label;

/** "24 Oct 2026" for the Settings line */
export function rulesAsOfText(): string {
  const [y, m, d] = RULES.asOf.split('-').map((x) => parseInt(x, 10));
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${d} ${months[m - 1]} ${y}`;
}
