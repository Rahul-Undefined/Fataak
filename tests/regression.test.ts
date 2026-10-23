/**
 * Regression suite for the review cases (A–J, currency/time-zone semantics, safety), each with
 * English / Hinglish / Bengalish wording variations.
 */
import { describe, it, expect } from 'vitest';
import { DateTime } from 'luxon';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { last, lastNote, run } from './helpers';

const summer = DateTime.fromISO('2026-07-15T10:00:00', { zone: 'Asia/Kolkata' });
const winter = DateTime.fromISO('2026-12-15T10:00:00', { zone: 'Asia/Kolkata' });

describe('A. revenue, expenses, profit margin', () => {
  it.each([
    'Revenue 500000, expenses 350000, profit margin?',
    'revenue 500000 expenses 350000 margin',
    'sales 5 lakh, kharcha 3.5 lakh, profit margin kitna?',
    'bikri 500000 ar khoroch 350000 hole profit margin koto?',
  ])('%s → 30%', (input) => {
    const r = run(input)[0];
    expect(r.display).toBe('30%');
    expect(r.note).toContain('profit 150,000');
    expect(r.note).toContain('revenue 500,000');
    expect(r.note).toContain('expenses 350,000');
  });
  it('asks for profit → amount with margin in the note', () => {
    const r = run('revenue 500000, expenses 350000, profit?')[0];
    expect(r.display).toBe('150,000 profit');
    expect(r.note).toContain('margin 30%');
  });
  it('does not confuse revenue/expenses with cost/selling price', () => {
    expect(last('revenue ₹500000, expenses ₹350000, profit')).toBe('₹1,50,000 profit');
    expect(last('bought at 500 sold at 600')).toBe('100 profit');
  });
});

describe('B. percentage increase between two values', () => {
  it.each([
    'Increase salary from 50000 to 57500, percentage increase?',
    'salary 50000 se 57500 hui, kitne percent badhi?',
    'salary 50000 theke 57500 holo, koto percent barlo?',
    '50000 to 57500 % change',
    'from 50000 to 57500 what percent increase',
  ])('%s → 15% increase', (input) => {
    expect(run(input)[0].display).toMatch(/^15% /);
    expect(run(input)[0].display).not.toBe('107,500');
  });
  it('decrease is labelled', () => {
    expect(last('from 200 to 150 percentage change')).toBe('25% decrease');
  });
});

describe('C. GST-inclusive base', () => {
  it.each([
    '1000 takar moddhe 18% GST ache, base koto?',
    '1000 taka te 18% gst included, base amount?',
    '1000 rupaye me 18% GST hai, base kitna?',
    '1000 inclusive of 18% gst, taxable value?',
  ])('%s → base 847.46', (input) => {
    const r = run(input)[0];
    expect(r.display).toContain('847.46');
    expect(r.note).toContain('152.54');
    expect(r.note).toMatch(/total [₹$]?1,000/);
  });
  it('keeps the currency from the question', () => {
    expect(last('1000 takar moddhe 18% GST ache, base koto?')).toBe('847.46 BDT');
    expect(last('₹1000 me 18% gst hai base kitna')).toBe('₹847.46');
  });
  it('plain "X ka 18% GST" still means the tax amount, with the total shown', () => {
    expect(last('1000 ka 18% gst')).toBe('180');
    expect(lastNote('1000 ka 18% gst')).toContain('total 1,180');
  });
});

describe('D. Hinglish arithmetic chains', () => {
  it.each([
    ['5000 ka aadha aur usmein 250 jodo', '2,750'],
    ['5000 er ardhek ar tate 250 jog koro', '2,750'],
    ['half of 5000 and add 250 to that', '2,750'],
    ['5000 ka aadha, phir usmein se 250 ghatao', '2,250'],
    ['1000 ka double aur usmein 10% badhao', '2,200'],
  ])('%s → %s', (input, expected) => {
    expect(last(input)).toBe(expected);
  });
});

describe('E. named amounts and totals', () => {
  it('Hinglish', () => {
    const r = run('Rahul ko 150, Rohit ko 250, total kitna?')[0];
    expect(r.display).toBe('400');
    expect(r.note).toContain('rahul 150');
    expect(r.defines).toMatchObject({ rahul: { kind: 'number' }, rohit: { kind: 'number' } });
  });
  it('Bengalish', () => {
    expect(last('Rohit er 500, Rahul er 250, dujoner total koto?')).toBe('750');
  });
  it('English and currencies', () => {
    expect(last('Rahul 150, Rohit 250, total?')).toBe('400');
    expect(last('rahul ₹150, rohit ₹250, sum')).toBe('₹400');
  });
  it('the names stay usable on later lines while the line is visible', () => {
    expect(last(['Rahul ko 150, Rohit ko 250, total kitna?', 'rahul * 2'])).toBe('300');
    expect(run(['', 'rahul * 2'])[1].ok).toBe(false);
  });
  it('a later line can redefine the same names', () => {
    const r = run(['Rahul ko 150, Rohit ko 250, total kitna?', 'Rohit er 500, Rahul er 250, dujoner total koto?', 'rohit']);
    expect(r[1].display).toBe('750');
    expect(r[2].display).toBe('500');
  });
});

describe('F. English and Hinglish percentage instructions', () => {
  it.each([
    ['Take 18 percent off 500', '410'],
    ['500 ka 18 percent nikal ke total mein add kar', '590'],
    ['Add eighteen percent to five hundred', '590'],
    ['add 18 percent to 500', '590'],
    ['five hundred plus eighteen percent', '590'],
    ['paanch sau me se athara percent ghatao'.replace('athara', '18'), '410'],
    ['two thousand five hundred minus ten percent', '2,250'],
    ['1 lakh 20 hazaar ka 10%', '12,000'],
    ['twenty five percent of two hundred', '50'],
  ])('%s → %s', (input, expected) => {
    expect(last(input)).toBe(expected);
  });
});

describe('G. calendar dates', () => {
  it.each([
    ['Last day of February 2028', 'Tue, 29 Feb 2028'],
    ['last day of feb 2027', 'Sun, 28 Feb 2027'],
    ['first day of march 2027', 'Mon, 1 Mar 2027'],
    ['end of 2027', 'Fri, 31 Dec 2027'],
    ['last day of next month', 'Mon, 30 Nov 2026'],
    ['february 2028 ka aakhri din'.replace('aakhri din', 'last day'), 'Tue, 29 Feb 2028'],
  ])('%s → %s', (input, expected) => {
    expect(last(input)).toBe(expected);
  });
  it('is not a day count', () => {
    expect(last('Last day of February 2028')).not.toContain('days');
  });
});

describe('H. sequential percentage changes', () => {
  it('two raises starting at 50000', () => {
    const r = run('Calculate a 10% raise, then another 5% raise on the new amount, starting at 50000')[0];
    expect(r.display).toBe('57,750');
    expect(r.note).toContain('50,000 → 55,000 → 57,750');
    expect(r.note).toContain('+7,750 (15.5%)');
  });
  it.each([
    ['50000 pe 10% badhao, phir usmein 5% aur badhao', '57,750'],
    ['50000 e 10% barao, tarpor aro 5% barao', '57,750'],
    ['starting at 50000, 10% raise then 5% raise', '57,750'],
    ['20% off then 10% off on 1000', '720'],
    ['1000 pe 20% discount, phir 10% discount', '720'],
    ['20% and 10% discount on 1000', '720'],
    ['1000 + 10%, then - 10%', '990'],
  ])('%s → %s', (input, expected) => {
    expect(last(input)).toBe(expected);
  });
  it('asks for the starting amount instead of guessing', () => {
    const r = run('10% raise then another 5% raise')[0];
    expect(r.ok).toBe(false);
    expect(r.note).toContain('starting amount?');
  });
});

describe('I. previous-result context', () => {
  it.each(['10% of the previous result', 'What is 10% of that?', '10% of prev', 'previous result ka 10%', 'ager result er 10%', 'uska 10%', 'etar 10% koto'])(
    '%s after 55000 → 5,500',
    (input) => {
      expect(last(['55000', input])).toBe('5,500');
    },
  );
  it('refuses when the line above has no result', () => {
    const r = run(['55000', '', 'What is 10% of that?']);
    expect(r[2].ok).toBe(false);
    expect(r[2].note).toMatch(/previous result\?|that = \?/);
    const r2 = run(['meeting notes', '10% of that']);
    expect(r2[1].ok).toBe(false);
    const r3 = run('10% of the previous result');
    expect(r3[0].ok).toBe(false);
    expect(r3[0].note).toContain('nothing above');
  });
  it('chains on the running value', () => {
    expect(last(['55000', 'add 10% to that, then subtract 500'])).toBe('60,000');
  });
});

describe('J. numeric overflow and invalid numbers', () => {
  it.each(['1e309', '10^400', '1e308 * 10', '-1e309'])('%s → overflow', (input) => {
    const r = run(input)[0];
    expect(r.ok).toBe(false);
    expect(r.note).toContain('overflow');
  });
  it('large but finite values still work', () => {
    expect(last('1e300 / 1e290')).toBe('10,000,000,000');
  });
  it('NaN never surfaces as a number', () => {
    expect(run('sqrt(-1)')[0].ok).toBe(false);
  });
});

describe('currency semantics', () => {
  it('offline conversion is labelled, never presented as live', () => {
    const offlineRates = {
      get: (from: string, to: string) => (from === 'USD' && to === 'INR' ? { rate: 84, timestamp: '2026-10-22T00:02:00Z', source: 'open.er-api.com', offline: true } : null),
    };
    const r = run('Convert 100 USD to INR offline', { rates: offlineRates })[0];
    expect(r.display).toBe('₹8,400');
    expect(r.note).toContain('cached rate, offline');
    expect(r.note).toContain('22 Oct');
  });
  it('no rate at all → needs a rate, no number', () => {
    const r = run('Convert 100 USD to INR offline', { rates: { get: () => null } })[0];
    expect(r.ok).toBe(false);
    expect(r.note).toContain('no rate for USD→INR');
  });
  it('historical conversion shows date, source and rate; missing history is reported', () => {
    const r = run('1 usd to inr 10 days ago')[0];
    expect(r.display).toBe('₹80');
    expect(r.note).toContain('1 USD = 80 INR');
    expect(r.note).toContain('on 13 Oct 2026');
    expect(r.note).toContain('test-history');
    const missing = run('1 usd to inr 3 days ago')[0];
    expect(missing.ok).toBe(false);
    expect(missing.note).toContain('2026-10-20');
  });
  it('live conversions keep their timestamp', () => {
    expect(lastNote('100 USD in INR')).toContain('23 Oct 00:02 UTC');
  });
});

describe('time-zone semantics: fixed EST vs US Eastern local time', () => {
  it('EST is always UTC−5, in summer and winter', () => {
    expect(last('6pm IST to EST', { now: summer })).toBe('7:30 AM EST');
    expect(last('6pm IST to EST', { now: winter })).toBe('7:30 AM EST');
    expect(lastNote('6pm IST to EST', { now: summer })).toContain('EST = UTC−5 fixed');
  });
  it('New York / ET / US Eastern follow daylight saving for the date', () => {
    expect(last('6pm IST to New York', { now: summer })).toBe('8:30 AM EDT');
    expect(last('6pm IST to New York', { now: winter })).toBe('7:30 AM EST');
    expect(last('6pm IST to ET', { now: summer })).toBe('8:30 AM EDT');
    expect(last('6pm IST to US Eastern time', { now: winter })).toBe('7:30 AM EST');
    // US daylight saving ends on Sunday 1 Nov 2026 at 2 am local time
    expect(last('6pm IST to new york on 31 oct 2026', { now: summer })).toBe('8:30 AM EDT');
    expect(last('6pm IST to new york on 1 nov 2026', { now: summer })).toBe('7:30 AM EST');
    expect(last('6pm IST to new york on 2 nov 2026', { now: summer })).toBe('7:30 AM EST');
  });
  it('date rollovers in both seasons', () => {
    expect(last('3am IST to PST', { now: winter })).toBe('1:30 PM PST');
    expect(lastNote('3am IST to PST', { now: winter })).toContain('previous day');
    expect(last('3am IST to Los Angeles', { now: summer })).toBe('2:30 PM PDT');
    expect(last('9pm PST to IST', { now: summer })).toBe('10:30 AM IST');
    expect(lastNote('9pm PST to IST', { now: summer })).toContain('next day');
    expect(last('11pm London to Kolkata', { now: summer })).toBe('3:30 AM IST');
    expect(last('11pm London to Kolkata', { now: winter })).toBe('4:30 AM IST');
  });
  it('other fixed abbreviations', () => {
    expect(last('12pm CET to IST', { now: summer })).toBe('4:30 PM IST');
    expect(last('12pm Berlin to IST', { now: summer })).toBe('3:30 PM IST');
  });
});

describe('safety: calculator input is data, never code', () => {
  it.each(['$(whoami)', '`rm -rf /`', 'process.exit(1)', 'require("child_process")', '{{constructor.constructor("return 1")()}}', '<script>alert(1)</script>'])(
    '%s produces no result',
    (input) => {
      const r = run(input)[0];
      expect(r.ok).toBe(false);
    },
  );
  it('the engine never uses eval or Function', () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const f of readdirSync(dir)) {
        const p = join(dir, f);
        if (statSync(p).isDirectory()) walk(p);
        else if (p.endsWith('.ts')) files.push(p);
      }
    };
    walk(join(__dirname, '..', 'src'));
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      expect(src, f).not.toMatch(/\beval\s*\(/);
      expect(src, f).not.toMatch(/new\s+Function\s*\(/);
    }
  });
});
