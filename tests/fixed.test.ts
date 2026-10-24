/** Fixed answers: facts, full forms, Indian finance constants, calendar facts. */
import { describe, it, expect } from 'vitest';
import { run } from './helpers';

const cases: [string, string][] = [
  ['what is the unit of water', 'litre (L)'],
  ['unit of electricity', 'kilowatt-hour (kWh), billed as "units"'],
  ['bijli ka unit kya hai', 'kilowatt-hour (kWh), billed as "units"'],
  ['pani ka unit', 'litre (L)'],
  ['what is the unit of distance', 'metre (m)'],
  ['unit of power', 'watt (W)'],
  ['si unit of force', 'newton (N)'],
  ['emi full form', 'Equated Monthly Instalment'],
  ['full form of sip', 'Systematic Investment Plan'],
  ['gst ka full form kya hai', 'Goods and Services Tax'],
  ['what does ctc stand for', 'Cost to Company'],
  ['tds meaning', 'Tax Deducted at Source'],
  ['80c limit', '₹1,50,000 a year'],
  ['section 80c', '₹1,50,000 a year'],
  ['standard deduction', '₹75,000 (new regime) · ₹50,000 (old regime)'],
  ['gst rates', '5% and 18% (since 22 Sep 2025); 40% on a few luxury and sin goods; 0% on essentials'],
  ['pf rate', '12% of basic + DA from you, 12% from the employer'],
  ['tds on fd', '10% once interest crosses ₹50,000 a year (₹1 lakh for senior citizens)'],
  ['how many days in a leap year', '366 days'],
  ['days in a year', '365 days'],
  ['hours in a day', '24 h'],
  ['1 tola in grams', '11.66 g'],
  ['5 tola in grams', '58.32 g'],
  ['tola', '11.66 g'],
  ['2 quintal in kg', '200 kg'],
  ['normal bmi', '18.5–24.9'],
  ['1 ream', '500'],
  ['one gross', '144'],
];

describe('fixed answers', () => {
  for (const [input, expected] of cases) {
    it(`${input} → ${expected}`, () => {
      const r = run([input])[0];
      expect(r.ok ? r.display : 'ERR: ' + r.display).toBe(expected);
    });
  }
  it('calculations are untouched', () => {
    expect(run(['unit price 50 * 3'])[0].display).toBe('150');
    expect(run(['25% of 480'])[0].display).toBe('120');
    expect(run(['water intake 70 kg'])[0].display).toBe('2.45 l/day');
  });
});
