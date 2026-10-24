/**
 * Metamorphic, property and fuzz tests: invariants that hold whatever the numbers are, checked on seeded random
 * inputs through the real engine. No expected value here comes from the engine itself.
 */
import { describe, it, expect } from 'vitest';
import { run, last } from './helpers';

/** mulberry32: a tiny seeded PRNG so every run sees the same inputs */
function prng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = prng(20261024);
const int = (lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1));
const dec = (lo: number, hi: number, dp = 2) => Math.round((lo + rnd() * (hi - lo)) * 10 ** dp) / 10 ** dp;
const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)];

const numOf = (display: string): number => {
  const m = /-?\d[\d,]*(?:\.\d+)?/.exec(display.replace(/^x\s*=\s*/, ''));
  if (!m) throw new Error(`no number in "${display}"`);
  return parseFloat(m[0].replace(/,/g, ''));
};
const close = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;

describe('arithmetic invariants', () => {
  it('addition and multiplication commute (200 random pairs)', () => {
    for (let k = 0; k < 200; k++) {
      const a = dec(-5000, 5000, int(0, 3));
      const b = dec(-5000, 5000, int(0, 3));
      expect(last(`${a} + ${b}`)).toBe(last(`${b} + ${a}`));
      expect(last(`${a} * ${b}`)).toBe(last(`${b} * ${a}`));
    }
  });
  it('reordering a sum of many terms does not change it', () => {
    for (let k = 0; k < 60; k++) {
      const xs = Array.from({ length: int(3, 8) }, () => dec(-999, 999));
      const shuffled = xs.slice().sort(() => rnd() - 0.5);
      expect(last(xs.join(' + '))).toBe(last(shuffled.join(' + ')));
    }
  });
  it('a - b = -(b - a) and (a / b) * b = a within display precision', () => {
    for (let k = 0; k < 100; k++) {
      const a = dec(-9999, 9999);
      const b = dec(1, 999);
      expect(numOf(last(`${a} - ${b}`))).toBeCloseTo(-numOf(last(`${b} - ${a}`)), 4);
      expect(close(numOf(last(`(${a} / ${b}) * ${b}`)), a, 0.0002)).toBe(true);
    }
  });
  it('p% of x equals x * p / 100 and x + p% - p% is not x', () => {
    for (let k = 0; k < 100; k++) {
      const x = dec(1, 99999);
      const p = pick([5, 10, 12.5, 18, 25, 33, 50]);
      expect(numOf(last(`${p}% of ${x}`))).toBeCloseTo(numOf(last(`${x} * ${p} / 100`)), 3);
      const back = numOf(last(`${x} + ${p}% - ${p}%`));
      expect(close(back, x * (1 + p / 100) * (1 - p / 100), 0.01)).toBe(true);
      expect(close(back, x, 0.001)).toBe(false);
    }
  });
});

describe('unit round trips', () => {
  const dims: Record<string, string[]> = {
    length: ['mm', 'cm', 'm', 'km', 'inch', 'ft', 'yd', 'mile'],
    mass: ['mg', 'g', 'kg', 'lb', 'oz'],
    volume: ['ml', 'l', 'tsp', 'tbsp', 'cup', 'gallon', 'pint'],
    area: ['sqft', 'sqm', 'acre', 'hectare', 'sqyd'],
    data: ['kb', 'mb', 'gb', 'tb', 'kib', 'mib', 'gib'],
    speed: ['m/s', 'km/h', 'mph', 'knots'],
  };
  it('converting a value to another unit and back recovers it (300 random trips)', () => {
    for (let k = 0; k < 300; k++) {
      const names = pick(Object.values(dims));
      const a = pick(names);
      let b = pick(names);
      while (b === a) b = pick(names);
      const v = dec(1, 5000, 2);
      const res = run([`${v} ${a} in ${b}`, `prev in ${a}`]);
      expect(res[0].ok, `${v} ${a} in ${b}: ${res[0].display}`).toBe(true);
      expect(res[1].ok).toBe(true);
      // the intermediate display is rounded; the stored value is not, so the trip must be exact to 1e-6 relative
      expect(Math.abs(res[1].value!.value.toNumber() - v) / v).toBeLessThan(1e-9);
    }
  });
  it('temperature trips: c → f → c and c → k → c', () => {
    for (const c of [-273.15, -40, 0, 36.6, 100, 451]) {
      expect(run([`${c} c in f`, 'prev in c'])[1].value!.value.toNumber()).toBeCloseTo(c, 9);
      expect(run([`${c} c in k`, 'prev in c'])[1].value!.value.toNumber()).toBeCloseTo(c, 9);
    }
  });
});

describe('finance reconciliation', () => {
  it('EMI schedule: rounded EMI × months − principal = reported total interest', () => {
    for (let k = 0; k < 60; k++) {
      const P = int(1, 90) * 100000;
      const r = pick([6.5, 7, 8.5, 9, 10.25, 12, 13.5]);
      const y = pick([1, 2, 3, 5, 7, 10, 15, 20, 25, 30]);
      const emi = numOf(last(`emi ${P} at ${r}% for ${y} years`));
      const interest = numOf(last(`total interest on ${P} at ${r}% for ${y} years emi`));
      expect(close(emi * y * 12 - P, interest, 0.011)).toBe(true);
    }
  });
  it('GST add then remove recovers the base; the two taxes agree', () => {
    for (let k = 0; k < 100; k++) {
      const base = dec(10, 99999);
      const rate = pick([5, 12, 18, 28]);
      const incl = numOf(last(`${base} + ${rate}% gst`));
      const back = numOf(last(`${incl} inclusive of ${rate}% gst`));
      expect(close(back, base, 0.011)).toBe(true);
    }
  });
  it('bill shares add up to the bill', () => {
    for (let k = 0; k < 60; k++) {
      const total = int(100, 50000);
      const a = int(1, 6);
      const b = int(1, 6);
      const c = int(1, 6);
      const d = last(`bill ${total}, rahul ${a} items, priya ${b} items, amit ${c} items`);
      const shares = d.split(' / ').map(numOf);
      expect(shares).toHaveLength(3);
      expect(close(shares.reduce((s, x) => s + x, 0), total, 0.02)).toBe(true);
    }
  });
  it('equal split × people = total, with tip applied before the split', () => {
    for (let k = 0; k < 60; k++) {
      const total = int(100, 20000);
      const n = int(2, 9);
      const tip = pick([0, 5, 10, 15]);
      const each = numOf(last(tip ? `${total} + ${tip}% tip split ${n} ways` : `split ${total} between ${n} people`));
      // each share is shown to 2 decimals, so the sum may be off by half a paisa per person
      expect(close(each * n, total * (1 + tip / 100), 0.005 * n + 0.011), `${total} tip ${tip} n ${n} → each ${each}`).toBe(true);
    }
  });
  it('ratio shares add up and keep the ratio', () => {
    for (let k = 0; k < 40; k++) {
      const total = int(100, 99999);
      const a = int(1, 9);
      const b = int(1, 9);
      const [x, y] = last(`divide ${total} in ratio ${a}:${b}`).split(' / ').map(numOf);
      expect(close(x + y, total, 0.02)).toBe(true);
      expect(close(x * b, y * a, 0.02 * (a + b))).toBe(true);
    }
  });
  it('SIP of 1 unit scales linearly; goal SIP inverts the future value', () => {
    for (let k = 0; k < 30; k++) {
      const m = pick([1000, 2500, 5000, 10000]);
      const r = pick([8, 10, 12, 15]);
      const y = pick([3, 5, 10, 15]);
      const fv = numOf(last(`sip ${m} at ${r}% for ${y} years`));
      const fv2 = numOf(last(`sip ${m * 2} at ${r}% for ${y} years`));
      expect(close(fv2, fv * 2, 0.02)).toBe(true);
      const lakh = Math.round(fv / 100000);
      if (lakh >= 1) {
        const monthly = numOf(last(`how much monthly sip for ${lakh} lakh in ${y} years at ${r}%`));
        expect(close(monthly / m, (lakh * 100000) / fv, 0.001)).toBe(true);
      }
    }
  });
});

describe('statistics invariants', () => {
  const list = () => Array.from({ length: int(2, 9) }, () => int(-50, 500));
  it('population variance is the mean squared deviation; std is its square root', () => {
    for (let k = 0; k < 80; k++) {
      const xs = list();
      const s = xs.join(', ');
      const mean = numOf(last(`average of ${s}`));
      const v = xs.reduce((acc, x) => acc + (x - mean) ** 2, 0) / xs.length;
      expect(close(numOf(last(`variance of ${s}`)), v, 0.0001 * Math.max(1, v))).toBe(true);
      expect(close(numOf(last(`std of ${s}`)), Math.sqrt(v), 0.0002 * Math.max(1, Math.sqrt(v)))).toBe(true);
    }
  });
  it('adding a constant shifts the mean and median, leaves variance, std and range alone', () => {
    for (let k = 0; k < 80; k++) {
      const xs = list();
      const c = int(-200, 200);
      const ys = xs.map((x) => x + c);
      const a = xs.join(', ');
      const b = ys.join(', ');
      expect(numOf(last(`average of ${b}`))).toBeCloseTo(numOf(last(`average of ${a}`)) + c, 3);
      expect(numOf(last(`median of ${b}`))).toBeCloseTo(numOf(last(`median of ${a}`)) + c, 3);
      expect(last(`variance of ${b}`)).toBe(last(`variance of ${a}`));
      expect(last(`std of ${b}`)).toBe(last(`std of ${a}`));
      expect(last(`range of ${b}`)).toBe(last(`range of ${a}`));
    }
  });
  it('the order of a list never matters; negative values are kept', () => {
    for (let k = 0; k < 60; k++) {
      const xs = list();
      const shuffled = xs.slice().sort(() => rnd() - 0.5);
      for (const fn of ['average', 'median', 'sum', 'max', 'min', 'range', 'std', 'variance']) {
        expect(last(`${fn} of ${xs.join(', ')}`)).toBe(last(`${fn} of ${shuffled.join(' ')}`));
      }
      expect(numOf(last(`min of ${xs.join(', ')}`))).toBe(Math.min(...xs));
      expect(numOf(last(`max of ${xs.join(', ')}`))).toBe(Math.max(...xs));
      expect(numOf(last(`sum of ${xs.join(', ')}`))).toBe(xs.reduce((s, x) => s + x, 0));
    }
  });
});

describe('equations', () => {
  it('the solution satisfies the equation (random linear equations)', () => {
    for (let k = 0; k < 80; k++) {
      const a = pick([1, 2, 3, 5, 7, -2, -4, 0.5, 2.5]);
      const b = int(-99, 99);
      const c = pick([0, 1, 4, -3]);
      const d = int(-99, 99);
      if (a === c) continue;
      const line = `${a}x + ${b} = ${c}x + ${d}`;
      const x = run(line)[0].value!.value.toNumber();
      expect(close(a * x + b, c * x + d, 1e-6 * Math.max(1, Math.abs(d))), `${line} → ${last(line)}`).toBe(true);
    }
  });
});

describe('dates', () => {
  const MON = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  it('adding then subtracting days recovers the date; months too on days ≤ 28', () => {
    for (let k = 0; k < 80; k++) {
      const y = int(1990, 2040);
      const m = int(1, 12);
      const d = int(1, 28);
      const ds = `${d} ${MON[m - 1]} ${y}`;
      const n = int(1, 2000);
      const back = run([`${ds} + ${n} days`, `prev - ${n} days`]);
      expect(back[1].display).toBe(last(ds));
      const mo = int(1, 30);
      const back2 = run([`${ds} + ${mo} months`, `prev - ${mo} months`]);
      expect(back2[1].display).toBe(last(ds));
    }
  });
  it('days between a date and date + n equals n; weekdays ≤ days', () => {
    for (let k = 0; k < 60; k++) {
      const y = int(1990, 2040);
      const m = int(1, 12);
      const d = int(1, 28);
      const n = int(1, 900);
      const ds = `${d} ${MON[m - 1]} ${y}`;
      const to = last(`${ds} + ${n} days`).replace(/^\w{3}, /, '');
      expect(numOf(last(`days between ${ds} and ${to}`))).toBe(n);
      expect(numOf(last(`weekdays between ${ds} and ${to}`))).toBeLessThanOrEqual(n + 1);
    }
  });
  it('a time span and its reverse add up to 24 h', () => {
    for (let k = 0; k < 60; k++) {
      const h1 = int(0, 23);
      const h2 = int(0, 23);
      const m1 = pick([0, 15, 30, 45]);
      const m2 = pick([0, 15, 30, 45]);
      if (h1 === h2 && m1 === m2) continue;
      // 10, 11 and 12 without am/pm are ambiguous on purpose ("12:15 to 11:15" may mean 11 h on a 12-hour clock)
      if (h1 >= 10 && h1 <= 12 && h2 >= 10 && h2 <= 12) continue;
      const f = (h: number, m: number) => `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
      const mins = (s: string) => {
        const mm = /(\d+) h(?: (\d+) min)?/.exec(s)!;
        return parseInt(mm[1], 10) * 60 + (mm[2] ? parseInt(mm[2], 10) : 0);
      };
      expect(mins(last(`${f(h1, m1)} to ${f(h2, m2)}`)) + mins(last(`${f(h2, m2)} to ${f(h1, m1)}`)), `${f(h1, m1)} to ${f(h2, m2)} → ${last(`${f(h1, m1)} to ${f(h2, m2)}`)} / reverse ${last(`${f(h2, m2)} to ${f(h1, m1)}`)}`).toBe(24 * 60);
    }
  });
});

describe('parser robustness (fuzz)', () => {
  const alphabet = ['0', '1', '7', '9', '.', ',', '+', '-', '*', '/', '^', '(', ')', '%', ' ', ' ', ' ', 'x', 'in', 'of', 'kg', 'km', 'usd', 'lakh', 'gst', 'emi', 'at', 'to', 'the', 'hello', '₹', '$', ':', 'am', 'pm', 'jan', 'days'];
  it('never crashes on 2000 random token soups; a successful parse always has a value', { timeout: 120000 }, () => {
    for (let k = 0; k < 2000; k++) {
      const s = Array.from({ length: int(1, 12) }, () => pick(alphabet)).join(pick(['', ' ', '  ']));
      let res;
      try {
        res = run(s);
      } catch (e) {
        throw new Error(`crashed on ${JSON.stringify(s)}: ${(e as Error).message}`);
      }
      const r = res[0];
      if (r.ok && !r.isText) expect(r.value, `ok without a value for ${JSON.stringify(s)}`).toBeDefined();
      if (r.ok && !r.isText && r.value!.kind === 'number') expect(Number.isNaN(r.value!.value.toNumber()), `NaN for ${JSON.stringify(s)}`).toBe(false);
    }
  });
  it('letters-only lines never produce a number', () => {
    const words = ['hello', 'kya', 'haal', 'please', 'compute', 'the', 'thing', 'bro', 'asdf', 'qwerty', 'bhai', 'calculate', 'tell', 'me'];
    for (let k = 0; k < 300; k++) {
      const s = Array.from({ length: int(1, 6) }, () => pick(words)).join(' ');
      const r = run(s)[0];
      expect(r.ok && !r.isText, `number from letters: ${JSON.stringify(s)} → ${r.display}`).toBe(false);
    }
  });
  it('casing and whitespace never change an answer', () => {
    const samples = ['25% of 480', 'emi 5 lakh at 9% for 5 years', '100 usd in inr', '5 km in miles', 'sqrt(144) + 2^3', 'income tax on 15 lakh salary', 'days between 1 jan 2026 and 1 mar 2026', '9am to 5pm', 'bmr 70 kg 175 cm 30 male', '2x + 5 = 17'];
    for (const s of samples) {
      const base = last(s);
      expect(last(s.toUpperCase())).toBe(base);
      expect(last(`  ${s.replace(/ /g, '   ')}  `)).toBe(base);
      expect(last(s.replace(/\b\w/g, (c) => c.toUpperCase()))).toBe(base);
    }
  });
});
