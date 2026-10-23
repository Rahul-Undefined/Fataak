import { describe, it, expect } from 'vitest';
import { last, lastNote, run } from './helpers';

describe('arithmetic', () => {
  it('basic operators and precedence', () => {
    expect(last('2 + 3 * 4')).toBe('14');
    expect(last('(2 + 3) * 4')).toBe('20');
    expect(last('2 ^ 10')).toBe('1,024');
    expect(last('10 / 4')).toBe('2.5');
    expect(last('-5 + 2')).toBe('-3');
    expect(last('10 mod 3')).toBe('1');
    expect(last('8 times 9')).toBe('72');
    expect(last('6 (3)')).toBe('18');
    expect(last('1,00,000 + 1')).toBe('100,001');
    expect(last('0.1 + 0.2')).toBe('0.3');
    expect(last('1/3')).toBe('0.3333');
  });

  it('scales', () => {
    expect(last('5k + 2 lakh')).toBe('205,000');
    expect(last('2.5 crore')).toBe('25,000,000');
    expect(last('1.5M')).toBe('1,500,000');
    expect(last('$2k')).toBe('$2,000');
  });

  it('functions', () => {
    expect(last('sqrt 16 + 2^3')).toBe('12');
    expect(last('sqrt(81)')).toBe('9');
    expect(last('round(3.456, 2)')).toBe('3.46');
    expect(last('fact 5')).toBe('120');
    expect(last('abs(-4)')).toBe('4');
    expect(last('max(3, 9, 4)')).toBe('9');
    expect(last('root 3 (27)')).toBe('3');
    expect(last('log 2 (8)')).toBe('3');
    expect(last('sin 90°')).toBe('1');
  });

  it('percentages (Numi rules)', () => {
    expect(last('$10 - 40%')).toBe('$6');
    expect(last('$500 + 18%')).toBe('$590');
    expect(last('20% of $10')).toBe('$2');
    expect(last('5% on $30')).toBe('$31.5');
    expect(last('6% off 40 EUR')).toBe('37.6 EUR');
    expect(last('$50 as a % of $100')).toBe('50%');
    expect(last('5% of what is 6 EUR')).toBe('120 EUR');
    expect(last('20% of what is 30 cm')).toBe('150 cm');
    expect(last('30 is what % of 150')).toBe('20%');
    expect(last('150 to 200 % change')).toBe('33.33% increase');
    expect(last('100 * 20%')).toBe('20');
  });

  it('variables, labels, prev, sum, average', () => {
    expect(last(['v = $20', 'v2 = 5%', 'v times 7 - v2'])).toBe('$133');
    expect(last(['Price: $11 + $34.45', 'prev * 2'])).toBe('$90.9');
    expect(last(['Line 1: $10', 'Line 2: $15', 'Result: sum'])).toBe('$25');
    expect(last(['Line 1: $10', 'Line 2: $15', 'Result: average'])).toBe('$12.5');
    expect(last(['$10', '$20', '', '$5', 'sum'])).toBe('$5');
    expect(last(['salary: 50000', 'salary * 12'])).toBe('600,000');
    expect(last(['Cost: $20', 'Discounted: prev - 5% discount'])).toBe('$19');
  });

  it('comments and text lines produce no result', () => {
    const r = run(['// comment', '# header', 'hello world', '$275 for the "Model 227"']);
    expect(r[0].isText).toBe(true);
    expect(r[1].isText).toBe(true);
    expect(r[2].isText).toBe(true);
    expect(r[3].display).toBe('$275');
  });

  it('units', () => {
    expect(last('20 ml in tea spoons')).toBe('4.06 tsp');
    expect(last('5 km in miles')).toBe('3.11 mi');
    expect(last('32 F in C')).toBe('0°C');
    expect(last('100 C in F')).toBe('212°F');
    expect(last('1 meter 20 cm')).toBe('120 cm');
    expect(last('2 hours 30 minutes in minutes')).toBe('150 min');
    expect(last('5 km + 3 km in miles')).toBe('4.97 mi');
    expect(last('10 kg in lbs')).toBe('22.05 lb');
    expect(last('3 GB in MB')).toBe('3,000 MB');
    expect(last('1 GiB in MB')).toBe('1,073.74 MB');
    expect(last('round(1 month in days)')).toBe('30 days');
    expect(last('1 sqft in sqm')).toBe('0.09 m²');
  });

  it('currency', () => {
    expect(last('100 USD in INR')).toBe('₹8,400');
    expect(last('₹5000 ka 18%')).toBe('₹900');
    expect(last('$30 in Euro')).toBe('27.6 EUR');
    expect(lastNote('100 USD in INR')).toContain('1 USD = 84 INR');
    expect(lastNote('100 USD in INR')).toContain('23 Oct 00:02 UTC');
    expect(last('$10 + 5 EUR in USD')).toBe('$15.43');
    expect(run('$10 + 5 EUR')[0].note).toContain('mixed currencies');
    expect(last('₹1,50,000 + 10%')).toBe('₹1,65,000');
    expect(last('100 USD in INR', { rates: { get: () => null } })).toBe('');
    expect(lastNote('100 USD in INR', { rates: { get: () => null } })).toContain('no rate');
    expect(last(['Price: $10', 'Fee: 4 GBP in Euro', 'sum in USD - 4%'])).toBe('$14.52');
  });

  it('errors are hints, never crashes', () => {
    const r = run(['5 +', '1 / 0', 'foo + 1', '5 km + 2 kg']);
    expect(r.every((x) => !x.ok)).toBe(true);
    expect(r[1].note).toContain('division by zero');
    expect(r[2].note).toContain('foo = ?');
  });
});
