/** Supplementary fixes after round 2: reverse percentages, quantity × price + tax, finance questions,
 *  math/rounding/compound units, dates with explicit DST dates, Bengalish chaining, currency mixing. */
import { describe, it, expect } from 'vitest';
import { DateTime } from 'luxon';
import { last, lastNote, run } from './helpers';

const summer = DateTime.fromISO('2026-07-15T10:00:00', { zone: 'Asia/Kolkata' });
const winter = DateTime.fromISO('2026-12-15T10:00:00', { zone: 'Asia/Kolkata' });

describe('reverse percentages', () => {
  it.each([
    ['840 is 12% less than what original amount?', '954.55'],
    ['750 is 20% more than what number?', '625'],
    ['840 kis amount se 12% kam hai?', '954.55'],
    ['750 kon number theke 20% beshi?', '625'],
    ['₹840 is 12% less than what?', '₹954.55'],
    ['what number is 750 20% more than?', '625'],
  ])('%s → %s', (input, expected) => {
    const r = run(input)[0];
    expect(r.display).toBe(expected);
  });
  it('is not confused with "P% of what is X"', () => {
    expect(last('20% of what is 30')).toBe('150');
  });
});

describe('quantity × price and tax steps', () => {
  it('5 items cost 24.75 each, add 12% tax → 138.6', () => {
    const r = run('5 items cost 24.75 each, add 12% tax')[0];
    expect(r.display).toBe('138.6');
    expect(r.note).toContain('123.75 → 138.6');
    expect(r.note).toContain('taxable base 123.75');
    expect(r.note).toContain('GST 14.85');
  });
  it.each([
    ['10% discount on 4500, then add 18% GST', '4,779'],
    ['4500 pe 10% discount, phir 18% gst lagao', '4,779'],
    ['4500 e 10% chhar, tarpor 18% gst add koro', '4,779'],
    ['5 pcs @ 24.75 each, then 12% tax', '138.6'],
    ['3 items at ₹120 each', '₹360'],
  ])('%s → %s', (input, expected) => {
    expect(last(input)).toBe(expected);
  });
});

describe('finance: the question asked', () => {
  it('simple interest vs amount', () => {
    expect(last('simple interest on 10000 at 5% for 2 years')).toBe('1,000');
    expect(last('10000 at 5% simple interest for 2 years, total amount?')).toBe('11,000');
    expect(last('10000 pe 5% byaj 2 saal, kitna milega?')).toBe('11,000');
    expect(lastNote('10000 pe 5% byaj 2 saal, kitna milega?')).toContain('interest 1,000');
  });
  it('compound interest vs maturity amount', () => {
    expect(last('compound interest on 10000 at 5% for 2 years')).toBe('1,025');
    expect(last('10000 at 5% compound interest for 2 years, maturity amount')).toBe('11,025');
    expect(last('10000 er 5% chakrabriddhi sud 2 bochor, sheshe koto pabo')).toBe('11,025');
    expect(last('total interest on 10000 at 5% compound for 2 years')).toBe('1,025');
  });
  it('EMI stays EMI', () => {
    expect(last('emi 5 lakh at 9% for 5 years')).toBe('10,379.18/month');
    expect(lastNote('emi 5 lakh at 9% for 5 years')).toContain('interest 122,750.8');
  });
});

describe('math, rounding and units', () => {
  it.each([
    ['Square root of 50 rounded to 3 decimal places', '7.071'],
    ['sqrt(50) to 2 dp', '7.07'],
    ['50 ka vargmool 3 decimal tak', '7.071'],
    ['2 to the power of 10', '1,024'],
    ['5 squared', '25'],
    ['cube root of 27', '3'],
    ['1/3 rounded to 4 decimal places', '0.3333'],
    ['10/4 rounded to 2 decimal places', '2.50'],
  ])('%s → %s', (input, expected) => {
    expect(last(input)).toBe(expected);
  });
  it.each([
    ['2.75 hours into hours and minutes', '2 hours 45 minutes'],
    ['2.75 hours in hours and minutes', '2 hours 45 minutes'],
    ['150 minutes in hours and minutes', '2 hours 30 minutes'],
    ['70 inches in feet and inches', '5 ft 10 in'],
    ['1.5 days in days and hours', '1 day 12 hours'],
    ['90 minutes in hours', '1.5 h'],
  ])('%s → %s', (input, expected) => {
    expect(last(input)).toBe(expected);
  });
  it('rounding keeps the stored value rounded too', () => {
    expect(last(['sqrt 50 rounded to 3 decimal places', 'prev * 1000'])).toBe('7,071');
  });
});

describe('dates and time zones with explicit dates', () => {
  it('explicit dates drive DST', () => {
    expect(last('6pm IST on 15 july 2026 to new york', { now: winter })).toBe('8:30 AM EDT');
    expect(last('6pm IST on 15 december 2026 to new york', { now: summer })).toBe('7:30 AM EST');
    expect(last('10am london on 25 oct 2026 to kolkata', { now: summer })).toBe('3:30 PM IST');
    expect(last('10am london on 24 oct 2026 to kolkata', { now: summer })).toBe('2:30 PM IST');
  });
  it('date differences and countdowns', () => {
    expect(last('days between 1 jan 2026 and 15 mar 2026')).toBe('73 days');
    expect(last('15 mar 2026 - 1 jan 2026')).toBe('73 days');
    expect(last('days until 25 dec 2026')).toBe('63 days');
    expect(last('25 dec 2026 tak kitne din')).toBe('63 days');
    expect(last('days from 1 jan 2026 to 1 jan 2027')).toBe('365 days');
    expect(last('1 mar 2028 - 1 feb 2028')).toBe('29 days');
  });
});

describe('Hinglish/Bengalish chaining', () => {
  it.each([
    ['1200 er 15 percent ber kore tar sathe 80 jog koro', '260'],
    ['1200 ka 15 percent nikal ke usme 80 jodo', '260'],
    ['15% of 1200 and add 80 to that', '260'],
    ['1200 er 15% ber koro, tarpor 80 jog koro', '260'],
    ['2000 ka 10% nikal ke usme se 50 ghatao', '150'],
  ])('%s → %s', (input, expected) => {
    expect(last(input)).toBe(expected);
  });
});

describe('currency: no silent mixing', () => {
  it('adding different currencies without a target asks for one', () => {
    const r = run('$100 + ₹500')[0];
    expect(r.ok).toBe(false);
    expect(r.note).toContain('mixed currencies');
    expect(r.note).toContain('in USD');
  });
  it('a named target currency converts explicitly, with the rate shown', () => {
    expect(last('$100 + ₹500 in USD')).toBe('$105.95');
    expect(lastNote('$100 + ₹500 in USD')).toContain('1 INR =');
    expect(last(['Price: $10', 'Fee: 4 GBP in Euro', 'sum in USD'])).toBe('$15.13');
    const r = run(['Price: $10', 'Fee: 4 GBP', 'sum'])[2];
    expect(r.ok).toBe(false);
    expect(r.note).toContain('mixed currencies');
  });
  it('offline conversions identify the cached rate and timestamp', () => {
    const cached = { get: (f: string, t: string, _d?: string, o?: { cachedOnly?: boolean }) => (f === 'USD' && t === 'INR' ? { rate: 84, timestamp: '2026-10-22T00:02:00Z', source: 'x', cached: !!o?.cachedOnly } : null) };
    expect(lastNote('100 USD in INR offline', { rates: cached })).toMatch(/^Cached rate · 1 USD = 84 INR · updated 22 Oct 00:02 UTC/);
  });
});
