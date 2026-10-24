/** Everyday calculators (groups A–D). Expected values computed independently with Python decimal / datetime. NOW = Fri 23 Oct 2026 10:00 IST. */
import { describe, it, expect } from 'vitest';
import { run } from './helpers';

const cases: [string | string[], string][] = [
  // A1 income tax FY 2025-26
  ['income tax on 12 lakh', '0'],
  ['income tax on 12 lakh salary', '0'],
  ['income tax on 15 lakh salary', '97,500'],
  ['income tax on 25 lakh', '343,200'],
  ['income tax on 15 lakh salary old regime', '257,400'],
  ['8 lakh pe income tax old regime', '75,400'],
  ['12.6 lakh salary pe tax kitna', '0'],
  ['income tax on 12.6 lakh', '62,400'],
  // A2 in hand
  ['ctc 12 lakh in hand', '87,800/month'],
  ['ctc 8 lakh take home', '58,466.67/month'],
  // A3 SIP, lump sum
  ['sip 5000 at 12% for 10 years', '1,161,695.38'],
  ['sip 10000 at 15% for 5 years', '896,816.89'],
  ['5000 monthly sip 12% 10 saal', '1,161,695.38'],
  ['lumpsum 1 lakh at 10% for 15 years', '417,724.82'],
  // A4 goal
  ['how much monthly sip for 50 lakh in 10 years at 12%', '21,520.27/month'],
  ['sip for 50 lakh in 10 years at 12%', '21,520.27/month'],
  // A5 FD / RD
  ['fd 2 lakh at 7.1% for 3 years', '247,015'],
  ['rd 5000 for 2 years at 6.5%', '128,425.3'],
  ['fd 1 lakh at 7% for 3 years', '123,143.93'],
  // A6 prepayment
  ['emi 30 lakh 8.5% 20 years, prepay 2 lakh after 2 years', '17 years 5 months'],
  // A7 doubling
  ['72 rule 8%', '9 years'],
  ['paisa double at 9%', '8 years'],
  ['money double at 12%', '6.1 years'],
  // A8 inflation
  ['10 lakh today in 10 years at 6% inflation', '1,790,847.7'],
  ['value of 10 lakh after 10 years at 6% inflation', '558,394.78'],
  ['1 lakh of 2010 in 2026', 'ERR'],
  // A9 rent
  ['rent 25000 with 10 months deposit', '250,000'],
  ['rent 25000 increase 5% for 3 years', '28,940.63'],
  // A10 bill shares
  ['bill 4800, rahul 2 items, priya 1 item', '3,200 / 1,600'],
  // B11 cooking
  ['2 cups in ml', '473.18 ml'],
  ['250 g flour in cups', '2.08 cups'],
  ['2 cups rice in g', '370 g'],
  ['350 f in c for oven', '176.67°C'],
  ['3 tbsp in tsp', '9 tsp'],
  // B12 sizes
  ['uk 9 shoe in us', 'US 10'],
  ['shoe size us 10 in eu', 'EU 42'],
  ['shirt size for 40 inch chest', 'L'],
  ['ideal weight for 175 cm', '70.5 kg'],
  ['ideal weight for 160 cm female', '52.4 kg'],
  // B13 fuel cost
  ['delhi to jaipur at 15 km/l petrol 105', '1,647.1'],
  ['400 km at 18 kmpl diesel 90', '2,000'],
  // B14 electricity
  ['1.5 ton ac 8 hours a day for 30 days at 8 per unit', '3,456'],
  ['1500 watt heater 3 hours daily 30 days at 7 per unit', '945'],
  ['1.5 ton ac 8 hours a day for 30 days units', '432 units'],
  // B15 dates
  ['diwali 2026', 'Sun, 8 Nov 2026'],
  ['days to diwali 2026', '16 days'],
  ['holi 2027', 'Mon, 22 Mar 2027'],
  ['diwali', 'Sun, 8 Nov 2026'],
  ['next birthday if born 15 aug 1990', 'Sun, 15 Aug 2027'],
  ['week number of 15 nov 2026', 'week 46'],
  // B16 shift hours
  ['9:30 to 18:45 minus 45 min, 22 days', '187 h'],
  // B17 time left
  ['time left until 5pm', '7 h'],
  ['5pm minus now', '7 h'],
  // B18 per-unit price
  ['5 kg at 450 vs 2 kg at 190, which is cheaper', '5 kg at 450 is cheaper'],
  // B19 words
  ['12,34,567 in words', 'twelve lakh thirty-four thousand five hundred sixty-seven'],
  ['1234567 in words international', 'one million two hundred thirty-four thousand five hundred sixty-seven'],
  ['twelve lakh thirty four thousand five hundred', '1,234,500'],
  // B20 roman, hex, binary
  ['2026 in roman', 'MMXXVI'],
  ['roman XIV', '14'],
  ['255 in hex', '0xFF'],
  ['10 in binary', '0b1010'],
  ['0b1010 + 5', '15'],
  ['0xff + 1', '256'],
  // C21 calories
  ['bmr 70 kg 175 cm 30 male', '1,649 kcal/day'],
  ['bmr 60 kg 165 cm 28 female', '1,330 kcal/day'],
  ['tdee 70 kg 175 cm 30 male moderate', '2,556 kcal/day'],
  ['calories to lose 0.5 kg a week', '550 kcal/day deficit'],
  // C22 water, steps, pace
  ['water intake 70 kg', '2.45 l/day'],
  ['10000 steps in km', '7.62 km'],
  ['5 km in 28 minutes pace', '5:36 min/km'],
  ['pace 5:30 for 10 km', '55 min'],
  // C23 study
  ['grade for 86%', 'A2'],
  ['average of 78 82 91 then what for 85 average', '89'],
  ['marks needed for 85 average with 78, 82, 91', '89'],
  // C24 proportion
  ['12 workers 8 days, 16 workers how many days', '6 days'],
  ['5 pens cost 60, 8 pens?', '96'],
  ['train 300 m at 72 km/h crosses platform 200 m', '25 s'],
  // D25 variables with units
  [['speed = 60 km/h', 'time = 2.5 h', 'speed * time'], '150 km'],
  // D26 equations
  ['2x + 5 = 17', 'x = 6'],
  ['x% of 80 = 20', 'x = 25'],
  ['3x = 2x + 10', 'x = 10'],
  ['x * x = 4', 'ERR'],
  // D27 statistics
  ['std of 4, 8, 15, 16', '4.9687'],
  ['variance of 4, 8, 15, 16', '24.6875'],
  ['range of 4, 8, 15, 16', '12'],
  ['90th percentile of 10, 20, 30, 40, 50', '50'],
  // D29 ranges
  ['x = 1 to 5', '1, 2, 3, 4, 5'],
  ['emi 5 lakh at 9% for 1 to 3 years', '1y: 43,725.74/month · 2y: 22,842.37/month · 3y: 15,899.87/month'],
];

describe('everyday calculators', () => {
  for (const [input, expected] of cases) {
    it(`${Array.isArray(input) ? input.join(' | ') : input} → ${expected}`, () => {
      const res = run(Array.isArray(input) ? input : [input]);
      const r = res[res.length - 1];
      expect(r.ok ? r.display : 'ERR').toBe(expected);
    });
  }
});
