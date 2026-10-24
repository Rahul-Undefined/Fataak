/**
 * Round five (24 Oct 2026): defects found by the generated adversarial benchmark (tests/gen) and the
 * metamorphic suite. Each case failed before its fix and documents the root cause.
 */
import { describe, it, expect } from 'vitest';
import { run } from './helpers';

const cases: [string | string[], string, string][] = [
  // negative numbers in a list were read as subtraction and silently dropped (NUM_RE had no sign; normalize split "- 5")
  ['range of 97 67 39 -5 97', '102', 'negative list members kept'],
  ['std of 4, -8, 15', '9.3927', 'negative list members kept'],
  ['average of 172 117 -15 -9 110 178 8', '80.1429', 'space-separated list with negatives'],
  ['sum of 27 31 44 155 -15 167 15.18 129 90', '643.18', 'space-separated list'],
  // a time span written in 24-hour form was lifted into the afternoon ("00:15" became 12:15 PM)
  ['10:30 to 00:15', '13 h 45 min', 'explicit 24-hour end is the next day'],
  ['16:45 to 10:30', '17 h 45 min', 'a 24-hour start makes the end the next morning'],
  ['10 baje se 5 baje tak kitne ghante', '7 h', 'bare 12-hour clock still lifts the end past noon'],
  ['9am to 5pm', '8 h', 'spans read h / min like every other duration'],
  // surcharge above 50 lakh was missing; other financial years silently used FY 2025-26 slabs
  ['income tax on 60 lakh', '1,578,720', 'surcharge 10% above 50 lakh'],
  ['income tax on 5000001', '1,123,201.04', 'surcharge marginal relief at the threshold'],
  ['income tax on 1 crore salary', '2,925,780', '15% surcharge band on a salary'],
  ['income tax on 15 lakh salary fy 2024-25', '130,000', 'FY 2024-25 slabs'],
  ['income tax on 7.5 lakh salary ay 2025-26', '0', 'AY 2025-26 = FY 2024-25, rebate up to 7 lakh after the 75,000 deduction'],
  ['income tax on 15 lakh salary fy 2026-27', 'ERR', 'unknown year: say so instead of guessing'],
  ['tax on salary of 1500000 new regime', '97,500', '"tax on salary" kept the salaried standard deduction'],
  // "31 feb 2026 + 1 day" was read as 31 and "feb 2026" → "28 days"
  ['31 feb 2026 + 1 day', 'ERR', 'impossible textual date errors'],
  ['feb 30 2026 + 1 day', 'ERR', 'impossible textual date errors (month-first form)'],
  // a trailing divisor was dropped from a discount/GST chain, and a parenthesised chain lost its base
  ['6196 - 10% + 18% gst / 3', '2,193.384', 'trailing ÷ applies to the whole chain'],
  ['(6196 - 10% + 18% gst) / 3', '2,193.384', 'parenthesised chain then ÷'],
  ['6196 minus 10% discount plus 18% gst split 3 ways', '2,193.384 each', 'split N ways after a chain'],
  ['bill 1200 + 15% tip split 4 ways', '345 each', 'tip-then-split still reads "each"'],
  // Hinglish steps: "ka 10% nikal ke … gst laga ke" dropped the first step; "me se … nikal ke" reversed GST
  ['24425 ka 10% nikal ke 18% gst laga ke total', '2,882.15', '10% of the amount, then GST on that'],
  ['24425 me se 10% nikal ke 18% gst laga ke total', '25,939.35', '10% off the amount, then GST'],
  ['500 ka 18% nikal ke total me add kar', '590', 'idiom still works'],
  ['2500 ka 5% nikaal ke usme 1200 jod do', '1,325', 'nikaal ke variant'],
  ['mere paas 25551 the, 180 kharch kiye, 626 aur mile, kitna bacha', '25,997', '"aur mile" = received'],
  // an amount projected over years without a rate produced a bare date
  ['10 lakh today in 10 years', 'ERR', 'asks for the inflation rate instead of answering with a date'],
  // "very active" matched "active" (TDEE × 1.725 instead of × 1.9)
  ['tdee 58 kg 145 cm 78 female very active', '1,777 kcal/day', 'activity level "very active"'],
  // cgpa rounded to one decimal; cups were singular; data conversions re-scaled an explicit target
  ['cgpa 8.5 in percentage', '80.75%', 'two decimals'],
  ['500 ml in cups', '2.11 cups', 'plural cups'],
  ['684.64 kb in mb', '0.68 MB', 'an explicit target unit is kept'],
  ['0.1 tb * 1', '100 GB', 'computed data values still scale to a readable unit'],
  // "convert … to <multi-word unit>" took the last word only; speed "for" time; area × length; 1 h exactly
  ['convert 792 ft to nautical mile', '0.13 nmi', 'multi-word target unit'],
  ['convert 2.5 sqft to sq yd', '0.28 sq yd', 'multi-word target unit'],
  ['72 km/h for 0.5 hours', '36 km', 'speed for a time is a distance'],
  ['2 m * 3 m * 4 m', '24 m³', 'area × length = volume'],
  ['10 ft * 10 ft * 8 ft', '800 ft³', 'area × length = volume in feet'],
  ['90 km at 90 km/h', '1 h', 'exactly one hour is not 60 min'],
  // a shoe size without its system assumed UK
  ['shoe size 9', 'ERR', 'asks UK, US or EU'],
  // "multiplied by" / "divided by" written as words act on the whole sum before them; a symbol keeps precedence
  ['what should be the 10+5 multiplied by 0', '0', 'spelled-out multiply applies to the sum'],
  ['10 + 5 multiplied by 0', '0', 'spelled-out multiply applies to the sum'],
  ['100 - 20 divided by 4', '20', 'spelled-out divide applies to the difference'],
  ['10 + 5 ka 3 guna', '45', 'Hindi multiply applies to the sum'],
  ['10 + 5 * 0', '10', 'a symbol keeps ordinary precedence'],
  ['multiply 10 by 0', '0', 'plain multiply'],
  // dates now always show the weekday, whichever path produced them
  ['14 mar 2033 + 100 days', 'Wed, 22 Jun 2033', 'weekday on date arithmetic'],
  ['today + 45 days', 'Mon, 7 Dec 2026', 'weekday on relative dates'],
  [['2026-01-01', 'prev + 30 days'], 'Sat, 31 Jan 2026', 'weekday on prev-based dates'],
];

describe('regression round five', () => {
  for (const [input, expected, why] of cases) {
    it(`${Array.isArray(input) ? input.join(' | ') : input} → ${expected} (${why})`, () => {
      const res = run(Array.isArray(input) ? input : [input]);
      const r = res[res.length - 1];
      expect(r.ok ? r.display : 'ERR').toBe(expected);
    });
  }
  it('income tax notes name the year, the surcharge and the marginal relief inputs', () => {
    const r = run('income tax on 60 lakh')[0];
    expect(r.note).toContain('FY 2025-26');
    expect(r.note).toContain('surcharge');
    expect(run('income tax on 15 lakh salary fy 2024-25')[0].note).toContain('FY 2024-25');
  });
});
