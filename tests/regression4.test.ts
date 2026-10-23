/** Mixed-calculation regression fixes: reverse percentages, margins from profit, allocations,
 *  cubic volumes, percent-of steps, precedence, weekday counts, invoices, chained raises/deductions. */
import { describe, it, expect } from 'vitest';
import { last, lastNote, run } from './helpers';

describe('reverse percentage with an outcome', () => {
  it.each([
    ['What original amount becomes 3910 after a 15% increase?', '3,400'],
    ['which amount becomes 2550 after a 15% decrease', '3,000'],
    ['15% badhne ke baad 3910 hota hai, original kitna tha?', '3,400'],
    ['15% badhne ke baad 3910 ho jata hai, pehle kitna tha?', '3,400'],
  ])('%s → %s', (input, expected) => {
    expect(last(input)).toBe(expected);
  });
});

describe('accounting: revenue, expenses, profit, margin', () => {
  it('margin from revenue and profit', () => {
    const r = run('Revenue is 12 lakh and net profit is 1.8 lakh. Calculate net profit margin.')[0];
    expect(r.display).toBe('15%');
    expect(r.note).toContain('revenue 1,200,000');
    expect(r.note).toContain('profit 180,000');
    expect(r.note).toContain('expenses 1,020,000');
  });
  it('revenue and expenses still work', () => {
    expect(last('Revenue 500000, expenses 350000, profit margin?')).toBe('30%');
    expect(last('revenue 12 lakh, profit 1.8 lakh, expenses?')).toBe('1,020,000 expenses');
  });
});

describe('allocation of a total', () => {
  it('percent shares with a remainder', () => {
    const r = run('Split 96000 into 25% rent, 18% food, 12% travel, 15% savings and remaining other expenses.')[0];
    expect(r.display).toBe('24,000 / 17,280 / 11,520 / 14,400 / 28,800');
    expect(r.note).toContain('rent 24,000');
    expect(r.note).toContain('food 17,280');
    expect(r.note).toContain('travel 11,520');
    expect(r.note).toContain('savings 14,400');
    expect(r.note).toContain('28,800');
    expect(r.defines).toMatchObject({ rent: { kind: 'number' }, food: { kind: 'number' }, travel: { kind: 'number' }, savings: { kind: 'number' } });
  });
  it('names stay usable; shares over 100% are rejected', () => {
    expect(last(['Split 96000 into 25% rent, 18% food, 12% travel, 15% savings and remaining other expenses.', 'rent + food'])).toBe('41,280');
    expect(last('₹96000 ko 25% rent, 18% food, 12% travel, 15% savings me baanto')).toBe('₹24,000 / ₹17,280 / ₹11,520 / ₹14,400 / ₹28,800');
    const bad = run('split 1000 into 60% a and 50% b')[0];
    expect(bad.ok).toBe(false);
    expect(bad.note).toContain('exceed 100%');
  });
});

describe('units: cubic volumes', () => {
  it.each([
    ['Convert 2.4 cubic metres to litres.', '2,400 l'],
    ['2.4 m3 in litres', '2,400 l'],
    ['500 cc in ml', '500 ml'],
    ['1 cubic foot in litres', '28.32 l'],
    ['3 cubic metres in cubic feet', '105.94 ft³'],
  ])('%s → %s', (input, expected) => {
    expect(last(input)).toBe(expected);
  });
});

describe('percent-of steps and precedence', () => {
  it('subtracting a percentage of another number', () => {
    const r = run('Calculate 15% of 800, then subtract 35% of 240.')[0];
    expect(r.display).toBe('36');
    expect(r.note).toContain('120');
    expect(r.note).toContain('84');
    expect(last('10% of 500 and add 20% of 300')).toBe('110');
    expect(last('800 ka 15% nikalo, phir usme se 240 ka 35% ghatao')).toBe('36');
  });
  it('operator precedence', () => {
    expect(last('(125 - 35) * (48 / 6) + 17')).toBe('737');
    expect(last('125 - 35 * 48 / 6 + 17')).toBe('-138');
    expect(last('2 + 3 * 4 ^ 2')).toBe('50');
  });
});

describe('weekday counts', () => {
  it('inclusive weekdays and weekends', () => {
    const r = run('How many weekdays are there from 1 January 2027 through 31 January 2027, inclusive?')[0];
    expect(r.display).toBe('21 weekdays');
    expect(last('working days between 1 jan 2027 and 31 jan 2027')).toBe('21 weekdays');
    expect(last('weekend days from 1 jan 2027 to 31 jan 2027')).toBe('10 weekend days');
    expect(last('1 jan 2027 se 31 jan 2027 tak kaam ke din kitne')).toBe('21 weekdays');
  });
  it('plain day differences stay exclusive unless asked', () => {
    expect(last('days between 1 jan 2027 and 31 jan 2027')).toBe('30 days');
    expect(last('days from 1 jan 2027 through 31 jan 2027 inclusive')).toBe('31 days');
  });
});

describe('invoice: discount before GST', () => {
  it('breakdown in the requested order', () => {
    const r = run('An invoice has 4 items at 1250 each, a 10% discount before GST, and 18% GST.')[0];
    expect(r.display).toBe('5,310');
    expect(r.note).toContain('5,000');
    expect(r.note).toContain('4,500 (−10% = 500)');
    expect(r.note).toContain('5,310 (+ GST 18% = 810)');
    expect(r.note).toContain('taxable value 4,500');
    expect(r.note).toContain('GST 810');
  });
  it.each([
    ['4 items @ 1250 each, 10% discount, then 18% gst', '5,310'],
    ['4 items at ₹1250 each, 18% GST, then 10% discount', '₹5,310'],
    ['1250 ke 4 items, 10% discount phir 18% gst', '5,310'],
  ])('%s → %s', (input, expected) => {
    expect(last(input)).toBe(expected);
  });
});

describe('chained raise and deduction', () => {
  it.each([
    ['Salary 68000, increase by 7%, then deduct 10%.', '65,484'],
    ['salary 68000 ko 7% badhao, phir 10% kaato'.replace('kaato', 'ghatao'), '65,484'],
    ['68000 me 7% badhao phir 10% ghatao', '65,484'],
  ])('%s → %s', (input, expected) => {
    const r = run(input)[0];
    expect(r.display).toBe(expected);
    expect(r.note).toContain('72,760');
  });
  it('a trailing period never changes a result', () => {
    expect(last('1000 + 10%.')).toBe('1,100');
    expect(last('Revenue 500000, expenses 350000, profit margin.')).toBe('30%');
    expect(lastNote('10000 pe 5% byaj 2 saal.')).toContain('total 11,000');
  });
});
