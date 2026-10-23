/** Round-2 regression suite: division, sequential discounts, previous-result policy, Bengalish percent,
 *  historical and offline conversion, GST-inclusive price + discount. */
import { describe, it, expect } from 'vitest';
import { last, lastNote, run, testRates } from './helpers';
import type { RateProvider } from '@engine/index';

describe('A. division among people / parts', () => {
  it.each([
    '50000 divided equally among 3 people',
    '50000 ko 3 logon mein equally divide karo',
    '50000 ke 3 equal parts',
    '50000 ke 3 bhag karo',
    'split 50000 between 3 people',
    '50000 taka 3 joner moddhe bhag koro'.replace('taka ', ''),
    '3 logon me 50000 baanto',
  ])('%s → 16,666.67 each', (input) => {
    const r = run(input)[0];
    expect(r.display).toBe('16,666.67 each');
    expect(r.note).toContain('50,000 ÷ 3');
    expect(r.note).toContain('exact 16,666.666667');
    expect(r.note).toContain('rounded');
  });
  it('keeps the currency and exact value', () => {
    const r = run('₹50000 divided among 3 people')[0];
    expect(r.display).toBe('₹16,666.67 each');
    expect(r.value!.value.toFixed(4)).toBe('16666.6667');
    expect(last(['50000 ke 3 bhag karo', 'prev * 3'])).toBe('50,000');
  });
  it('exact divisions carry no rounding note', () => {
    const r = run('900 ke 3 bhag karo')[0];
    expect(r.display).toBe('300 each');
    expect(r.note).not.toContain('rounded');
  });
});

describe('B. sequential discounts', () => {
  it('two discounts with requested outputs', () => {
    const r = run('Discount 20% followed by another 10% discount on 1000; calculate final price and effective discount')[0];
    expect(r.display).toBe('720');
    expect(r.note).toContain('1,000 → 800 → 720');
    expect(r.note).toContain('−280 (28%)');
  });
  it.each([
    ['20% then 10% discount on 1000', '720'],
    ['1000 pe pehle 20% discount, phir 10% discount', '720'],
    ['1000 e 20% chhar, tarpor abar 10% chhar', '720'],
    ['20% and 10% discount on 1000', '720'],
    ['1000 pe 20% chhoot aur phir 10% aur', '720'],
    ['apply 20% off then another 10% off starting at 1000', '720'],
  ])('%s → %s', (input, expected) => {
    expect(last(input)).toBe(expected);
  });
});

describe('C. previous-result references (documented policy)', () => {
  it('"that" and "previous result" use the nearest valid result above', () => {
    const doc = ['Calculate a 10% raise, then another 5% raise on the new amount, starting at 50000', "What's 10% of that?"];
    expect(last(doc)).toBe('5,775');
    expect(last(['1000 takar moddhe 18% GST ache, base koto?', '10% of the previous result'])).toBe('84.75 BDT');
    expect(run(['1000 takar moddhe 18% GST ache, base koto?', '10% of the previous result'])[1].value!.value.toFixed(6)).toBe('84.745763');
  });
  it('a failed, blank or text line never replaces the last valid result', () => {
    expect(last(['57750', '5 +', 'What is 10% of that?'])).toBe('5,775');
    expect(last(['57750', '', 'notes for later', '10% of the previous result'])).toBe('5,775');
    expect(last(['57750', 'foo + 1', 'prev * 2'])).toBe('115,500');
  });
  it('variable assignments count as results', () => {
    expect(last(['salary: 50000', '10% of that'])).toBe('5,000');
    expect(last(['rahul Rs 100', 'that * 3'])).toBe('₹300');
  });
  it('context resets only on explicit request', () => {
    const r = run(['57750', 'clear context', '10% of that']);
    expect(r[1].resetsContext).toBe(true);
    expect(r[1].note).toBe('context cleared');
    expect(r[2].ok).toBe(false);
    expect(r[2].note).toContain('context was cleared');
    expect(run(['salary: 50000', 'reset', 'salary * 2'])[2].ok).toBe(false);
    expect(last(['57750', 'sab bhool jao', '100', '10% of that'])).toBe('10');
  });
  it('no usable prior result is explained', () => {
    const r = run("What's 10% of that?")[0];
    expect(r.ok).toBe(false);
    expect(r.note).toMatch(/no result above/);
  });
});

describe('D. Bengalish percentage', () => {
  it.each([
    ['2500 takar 5 percent ber koro', '125 BDT'],
    ['2500 takar 5% koto?', '125 BDT'],
    ['2500 er 5 percent koto?', '125'],
    ['2500 taka theke 5 percent ber koro', '125 BDT'],
    ['2500 takay 5% kato hobe', '125 BDT'],
    ['2500 rupaye ka 5 percent nikalo', '₹125'],
  ])('%s → %s', (input, expected) => {
    const r = run(input)[0];
    expect(r.display).toBe(expected);
    expect(r.note).toContain('5% of');
  });
});

describe('E. historical currency conversion', () => {
  it('"using the historical rate for <date>" is a dated conversion, not a parser error', () => {
    const r = run('100 USD to INR using the historical rate for 13 October 2026')[0];
    expect(r.display).toBe('₹8,000');
    expect(r.note).toContain('1 USD = 80 INR');
    expect(r.note).toContain('on 13 Oct 2026');
    expect(r.note).toContain('test-history');
  });
  it('discloses when the provider answered with the previous business day', () => {
    const weekendRates: RateProvider = {
      get: (from, to, date) => (date === '2026-10-11' ? { rate: 79, timestamp: '2026-10-09', source: 'ECB (test)' } : testRates.get(from, to, date)),
    };
    const r = run('100 usd in inr on 11 oct 2026', { rates: weekendRates })[0];
    expect(r.display).toBe('₹7,900');
    expect(r.note).toContain('on 9 Oct 2026 (no rate on 11 Oct 2026; previous business day)');
  });
  it('unavailable history is an error, never an invented rate', () => {
    const r = run('100 USD to INR using the historical rate for 1 January 2025')[0];
    expect(r.ok).toBe(false);
    expect(r.note).toContain('2025-01-01');
  });
});

describe('F. GST-inclusive price followed by a discount', () => {
  it('final payable is the discounted inclusive price, with the split shown', () => {
    const r = run('1000 including 18% GST, then apply 10% discount')[0];
    expect(r.display).toBe('900');
    expect(r.note).toContain('1,000 → 900');
    expect(r.note).toContain('−100 (10%)');
    expect(r.note).toContain('taxable base 762.71');
    expect(r.note).toContain('GST 137.29');
  });
  it.each([
    ['₹1000 GST samet 18%, phir 10% discount', '₹900'],
    ['1000 taka 18% gst dhore, tarpor 10% chhar', '900 BDT'],
    ['25000 + 18% gst, then 5% discount', '28,025'],
  ])('%s → %s', (input, expected) => {
    expect(last(input)).toBe(expected);
  });
  it('a plain GST-inclusive question still returns the base', () => {
    expect(last('1000 including 18% GST')).toBe('847.46');
  });
});

describe('G. offline currency conversion', () => {
  const cachedOnlyRates: RateProvider = {
    get: (from, to, _date, opts) => {
      if (from !== 'USD' || to !== 'INR') return null;
      return { rate: 84, timestamp: '2026-10-22T00:02:00Z', source: 'open.er-api.com', cached: !!opts?.cachedOnly };
    },
  };
  it('labels a cached rate and when it was updated', () => {
    const r = run('Convert 100 USD to INR offline', { rates: cachedOnlyRates })[0];
    expect(r.display).toBe('₹8,400');
    expect(r.note).toMatch(/^Cached rate · 1 USD = 84 INR · updated 22 Oct 00:02 UTC/);
  });
  it('says the rate is unavailable offline when nothing is cached', () => {
    const r = run('Convert 100 USD to INR offline', { rates: { get: () => null } })[0];
    expect(r.ok).toBe(false);
    expect(r.note).toContain('rate unavailable offline');
  });
  it('a live line is not labelled cached', () => {
    expect(lastNote('Convert 100 USD to INR')).not.toContain('Cached');
  });
  it('a fetch that fell back to disk is labelled offline', () => {
    const offline: RateProvider = { get: () => ({ rate: 84, timestamp: '2026-10-22T00:02:00Z', source: 'open.er-api.com', offline: true }) };
    expect(lastNote('100 USD in INR', { rates: offline })).toMatch(/^Cached rate .* · offline$/);
  });
});

describe('previous fixes still hold', () => {
  it.each([
    ['Revenue 500000, expenses 350000, profit margin?', '30%'],
    ['Increase salary from 50000 to 57500, percentage increase?', '15% increase'],
    ['5000 ka aadha aur usmein 250 jodo', '2,750'],
    ['Rahul ko 150, Rohit ko 250, total kitna?', '400'],
    ['Take 18 percent off 500', '410'],
    ['500 ka 18 percent nikal ke total mein add kar', '590'],
    ['Last day of February 2028', 'Tue, 29 Feb 2028'],
    ['Calculate a 10% raise, then another 5% raise on the new amount, starting at 50000', '57,750'],
  ])('%s → %s', (input, expected) => {
    expect(last(input)).toBe(expected);
  });
  it('overflow and fixed-offset zones', () => {
    expect(run('1e309')[0].note).toContain('overflow');
    expect(last('6pm IST to EST')).toBe('7:30 AM EST');
    expect(last('6pm IST to EDT')).toBe('8:30 AM EDT');
  });
});
