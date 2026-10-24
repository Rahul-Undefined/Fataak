/**
 * Regressions from the reliability audit. Expected values come from the stated formula or a hand
 * calculation, never from the engine.
 */
import { describe, it, expect } from 'vitest';
import { last, lastNote, run } from './helpers';

describe('parser: precedence, unary minus, factorial, lists', () => {
  it.each([
    ['-2 ^ 2', '-4'], // -(2²)
    ['(-2) ^ 2', '4'],
    ['-3 ^ 2 + 1', '-8'],
    ['2 ^ 3 ^ 2', '512'], // right-associative: 2^(3^2)
    ['(2 ^ 3) ^ 2', '64'],
    ['2 * -3', '-6'],
    ['10 - 2 - 3', '5'],
    ['10 / 4 * 2', '5'],
    ['2 ^ -1', '0.5'],
    ['5!', '120'],
    ['0!', '1'],
    ['double 45', '90'],
    ['half 90', '45'],
    ['triple 7', '21'],
    ['avg(10, 20, 30)', '20'],
    ['average of 10, 20, 30', '20'],
    ['median of 3, 9, 4', '4'],
    ['median of 1, 2, 3, 4', '2.5'],
    ['max(1, 5, 3)', '5'],
    ['sum(1, 2, 3)', '6'],
    ['ratio 3:4 of 700', '300 / 400'],
    ['divide 700 in ratio 3:4', '300 / 400'],
    ['divide 900 in ratio 1:2:3', '150 / 300 / 450'],
    ['what is 7 times 8', '56'],
    ['seven times eight', '56'],
    ['10 squared minus 5 squared', '75'],
    ['12 ka 3 guna', '36'],
    ['round(2.675, 2)', '2.68'], // half-up on the exact decimal, not binary 2.67499…
    ['0.1 * 3', '0.3'],
    ['1 - 0.9', '0.1'],
  ])('%s → %s', (input, expected) => {
    expect(last(input)).toBe(expected);
  });
  it('rejects what it cannot read instead of guessing', () => {
    for (const bad of ['5%%', '5 5', '$$5', 'x == 10', '10% of', 'today + tomorrow', '5 km + 2 hours']) {
      const r = run(bad)[0];
      expect(r.ok, bad).toBe(false);
    }
  });
});

describe('percentages: increase vs decrease vs difference vs points', () => {
  it.each([
    ['40 is what percent more than 32', '25% increase'], // (40−32)/32
    ['32 is what % less than 40', '20% decrease'], // (32−40)/40
    ['percentage difference between 40 and 50', '22.22% difference'], // 10 / 45
    ['10 is 20% of what', '50'],
    ['10 is 20% of what number', '50'],
    ['5 percentage points more than 20%', '25%'],
    ['20% + 5 percentage points', '25%'],
    ['successive discounts of 10% and 20% on 1000', '720'],
    ['1000 grows 10% a year for 3 years', '1,331'],
    ['reverse 18% on 1180', '1,000'],
    ['100 decreased by 100%', '0'],
    ['20% of 20% of 100', '4'],
    ['a 15% increase on 200 then 15% decrease', '195.5'],
  ])('%s → %s', (input, expected) => {
    expect(last(input)).toBe(expected);
  });
});

describe('finance: tax stacks, cost from sale, accounting lines, loan types', () => {
  it.each([
    ['1000 + 5% gst + 2% cess', '1,070'],
    ['cgst sgst on 1000 at 18%', '1,180'],
    ['cost price if sold at 500 with 25% profit', '400'],
    ['cost price if sold at 300 with 25% loss', '400'],
    ['gross margin revenue 1000 cogs 600', '40% gross margin'],
    ['revenue 1000 cogs 600 opex 200 operating profit', '200 operating profit'],
    ['si 10000 8% 3 years', '2,400'],
    ['ci 10000 8% 3 years monthly', '2,702.37'], // 10000·(1+0.08/12)^36 − 10000
    ['flat rate loan 100000 at 10% for 2 years monthly payment', '5,000/month'], // (100000 + 20000) / 24
    ['total interest on emi 10 lakh at 8.5% for 20 years', '1,082,775.2'],
    ['loan 500000 at 9% for 5 years total payment', '622,750.8'],
    ['emi 500000 at 0% for 12 months', '41,666.67/month'],
    ['bill 1200 + 15% tip split 4 ways', '345 each'],
    ['3 items at 250 each with 5% gst', '787.5'],
    ['invoice: 2 items at 500, 3 items at 200, 18% gst', '1,888'],
    ['compound interest 10000 at 8% for 3 years quarterly', '2,682.42'], // 10000·(1.02)^12 − 10000
  ])('%s → %s', (input, expected) => {
    expect(last(input)).toBe(expected);
  });
  it('ambiguous or impossible finance questions are refused', () => {
    expect(run('10000 at 8% for 3 years amount')[0].note).toContain('simple or compound');
    expect(run('emi 500000 at 9% for 0 months')[0].note).toContain('at least 1 month');
    expect(lastNote('emi 500000 at 0% for 12 months')).toContain('interest 0');
  });
});

describe('units: result unit follows the inputs', () => {
  it.each([
    ['5 ft 10 in in cm', '177.8 cm'],
    ['10 m / 2 s', '5 m/s'],
    ['100 km / 2 hours', '50 km/h'],
    ['72 km/h in m/s', '20 m/s'],
    ['1 ly in km', '9,460,730,472,580.8 km'],
    ['-273.15 c in k', '0 K'],
    ['1 kg in lb and oz', '2 lb 3.27 oz'],
    ['5 m * 5 m', '25 m²'],
    ['200 minutes in hours and minutes', '3 hours 20 minutes'],
  ])('%s → %s', (input, expected) => {
    expect(last(input)).toBe(expected);
  });
});

describe('dates: counts, questions, relative days, time spans', () => {
  it.each([
    ['days since 1 jan 2026', '295 days'],
    ['weeks between 1 jan 2026 and 1 mar 2026', '8.43 weeks'],
    ['months between 15 jan 2026 and 15 jul 2026', '6 months'],
    ['what day is 15 aug 2026', 'Saturday, 15 Aug 2026'],
    ['is 2028 a leap year', '2028: leap year'],
    ['is 2100 a leap year', '2100: not a leap year'],
    ['how many days in feb 2028', '29 days'],
    ['days in february 2027', '28 days'],
    ['weekdays in march 2026', '22 weekdays'],
    ['weekends in march 2026', '9 weekend days'],
    ['age if born 15 aug 1990', '36 years'],
    ['2 din pehle', 'Wed, 21 Oct 2026'],
    ['3 din baad', 'Mon, 26 Oct 2026'],
    ['agle somvar', 'Mon, 26 Oct 2026'],
    ['aaj ka din kya hai', 'Friday, 23 Oct 2026'],
    ['aaj kaunsa din hai', 'Friday, 23 Oct 2026'],
    ['hours between 9am and 5:30pm', '8 h 30 min'],
    ['9am to 5pm minus 30 min break', '7 h 30 min'],
    ['10 baje se 5 baje tak kitne ghante', '7 h'],
    ['subah 10 baje se sham 5 baje tak kitne ghante', '7 h'],
    ['10pm to 6am', '8 h'],
    ['february 2028 ka last day', 'Tue, 29 Feb 2028'],
    ['31 jan 2027 + 1 month', 'Sun, 28 Feb 2027'],
    ['29 feb 2028 + 1 year', 'Wed, 28 Feb 2029'],
    ['days between 28 feb 2028 and 1 mar 2028', '2 days'],
    ['days between 28 feb 2027 and 1 mar 2027', '1 day'],
  ])('%s → %s', (input, expected) => {
    expect(last(input)).toBe(expected);
  });
});

describe('currency and context', () => {
  it('sums of several currencies need a target and then convert each term', () => {
    expect(last('sum of 100 usd and 100 eur in inr')).toBe('₹17,530.43'); // 8400 + 100/0.92·84
    expect(run('$100 + ₹500')[0].note).toContain('mixed currencies');
    expect(last('$100 + ₹500 in inr')).toBe('₹8,900');
  });
  it('a rate problem is reported as such, never re-read as prose', () => {
    const r = run('1 usd to inr 3 days ago')[0];
    expect(r.ok).toBe(false);
    expect(r.note).toContain('no USD→INR rate for 2026-10-20');
  });
  it('percent lines do not pollute a block sum', () => {
    expect(last(['price: 100', 'tax: 18%', 'price + price * tax', 'sum'])).toBe('218');
  });
  it('a bare colon inside a time or ratio is not a label', () => {
    const r = run('5:30pm + 1 hour')[0];
    expect(r.display).toBe('6:30 PM');
    expect(r.label).toBeUndefined();
    expect(run('Line 1: $10')[0].label).toBe('line 1');
  });
});

describe('audit follow-up: scale words in multiplication, anchored offsets, cost-only lines', () => {
  it.each([
    ['3 lakh ka 2 guna', '600,000'],
    ['2.5 lakh ka 3 guna', '750,000'],
    ['aaj ke 45 din baad', 'Mon, 7 Dec 2026'],
    ['kal ke 10 din baad', 'Tue, 3 Nov 2026'],
    ['today 3 weeks later', 'Fri, 13 Nov 2026'],
    ['5 items cost 24.75 each add 12% tax', '138.6'], // no comma: still 5 × 24.75 + 12%, never a profit/loss guess
    ['cost 24.75', '24.75'],
    ['cost 500 sold 600', '100 profit'],
  ])('%s → %s', (input, expected) => {
    expect(last(input)).toBe(expected);
  });
});
