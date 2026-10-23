/**
 * Property-style checks: identities that must hold for many values, evaluated through the real
 * engine. Values are generated from a fixed seed so runs are reproducible.
 */
import { describe, it, expect } from 'vitest';
import { Decimal } from '@engine/types';
import * as fin from '@engine/finance';
import { convertUnit, unitById, UNITS } from '@engine/units';
import { run } from './helpers';

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}
const rand = rng(42);
const amounts = Array.from({ length: 40 }, () => Math.round(rand() * 1_000_000) / 100 + 1);
const rates = Array.from({ length: 40 }, () => Math.round(rand() * 9000) / 100 + 0.5);

function value(input: string): Decimal {
  const r = run(input)[0];
  if (!r.ok) throw new Error(`${input} → ${r.note}`);
  return r.value!.value;
}

describe('percentage identities', () => {
  it('increase then reverse returns the original (within rounding)', () => {
    for (let i = 0; i < amounts.length; i++) {
      const a = amounts[i];
      const p = rates[i];
      const up = value(`${a} + ${p}%`);
      const back = value(`${up.toString()} is ${p}% more than what`);
      expect(back.minus(a).abs().lte('0.000001'), `${a} +${p}%`).toBe(true);
    }
  });
  it('X% of Y equals Y% of X', () => {
    for (let i = 0; i < 20; i++) {
      const [x, y] = [amounts[i], amounts[i + 20]];
      expect(value(`${x}% of ${y}`).toFixed(6)).toBe(value(`${y}% of ${x}`).toFixed(6));
    }
  });
  it('successive discounts commute and never exceed 100%', () => {
    for (let i = 0; i < 20; i++) {
      const [p, q] = [rates[i] % 50, rates[i + 20] % 50];
      const a = value(`${p}% off then ${q}% off on 1000`);
      const b = value(`${q}% off then ${p}% off on 1000`);
      expect(a.toFixed(6)).toBe(b.toFixed(6));
      expect(a.gte(0) && a.lte(1000)).toBe(true);
    }
  });
  it('GST add then reverse returns the base', () => {
    for (const base of amounts) {
      for (const r of [5, 12, 18, 28]) {
        const total = fin.gstAdd(new Decimal(base), new Decimal(r)).total;
        const back = fin.gstRemove(total, new Decimal(r)).base;
        expect(back.minus(base).abs().lte('0.01'), `${base} @ ${r}%`).toBe(true);
      }
    }
  });
  it('margin ↔ markup conversions are inverse', () => {
    for (const m of rates.filter((r) => r < 90)) {
      const mk = fin.marginToMarkup(new Decimal(m));
      const back = fin.markupToMargin(mk);
      expect(back.minus(m).abs().lte('0.02'), `${m}`).toBe(true);
    }
  });
});

describe('unit conversion consistency', () => {
  it('converting there and back is the identity for every unit pair in a dimension', () => {
    for (const a of UNITS) {
      for (const b of UNITS) {
        if (a.dim !== b.dim || a.id === b.id) continue;
        const x = new Decimal('123.456');
        const back = convertUnit(convertUnit(x, a, b), b, a);
        expect(back.minus(x).abs().lte('1e-9'), `${a.id}→${b.id}`).toBe(true);
      }
    }
  });
  it('authoritative definitions', () => {
    const m = (id: string) => unitById(id)!;
    expect(convertUnit(new Decimal(1), m('inch'), m('cm')).toString()).toBe('2.54');
    expect(convertUnit(new Decimal(1), m('mile'), m('m')).toString()).toBe('1609.344');
    expect(convertUnit(new Decimal(1), m('lb'), m('g')).toString()).toBe('453.59237');
    expect(convertUnit(new Decimal(1), m('gal'), m('l')).toString()).toBe('3.785411784');
    expect(convertUnit(new Decimal(100), m('c'), m('f')).toString()).toBe('212');
    expect(convertUnit(new Decimal(0), m('k'), m('c')).toString()).toBe('-273.15');
    expect(convertUnit(new Decimal(1), m('acre'), m('sqm')).toString()).toBe('4046.8564224');
    expect(convertUnit(new Decimal(1), m('m3'), m('l')).toString()).toBe('1000');
  });
  it('engine results carry the target unit', () => {
    for (const [input, unit] of [
      ['5 km in miles', 'mi'],
      ['70 kg in lbs', 'lb'],
      ['30 c in f', '°F'],
      ['2 hours in minutes', 'min'],
      ['1 gb in mb', 'MB'],
    ] as const) {
      expect(run(input)[0].display.endsWith(unit), input).toBe(true);
    }
  });
});

describe('arithmetic identities through the engine', () => {
  it('a + b − b = a and (a × b) ÷ b = a with exact decimals', () => {
    for (let i = 0; i < 20; i++) {
      const [a, b] = [amounts[i], amounts[i + 20]];
      expect(value(`${a} + ${b} - ${b}`).toString()).toBe(new Decimal(a).toString());
      expect(value(`${a} * ${b} / ${b}`).toString()).toBe(new Decimal(a).toString());
    }
  });
  it('percent of a sum distributes', () => {
    for (let i = 0; i < 20; i++) {
      const [a, b, p] = [amounts[i], amounts[i + 20], rates[i]];
      const whole = value(`${p}% of (${a} + ${b})`);
      const parts = value(`${p}% of ${a}`).plus(value(`${p}% of ${b}`));
      expect(whole.minus(parts).abs().lte('1e-9')).toBe(true);
    }
  });
  it('EMI totals are consistent: payment × months = principal + interest', () => {
    for (let i = 0; i < 20; i++) {
      const principal = new Decimal(amounts[i]).mul(100);
      const r = fin.emi(principal, new Decimal(rates[i] % 20), 12 * (1 + (i % 10)));
      expect(r.totalPayment.toString()).toBe(r.totalInterest.plus(principal).toString());
    }
  });
  it('simple interest is linear in time and rate', () => {
    for (let i = 0; i < 20; i++) {
      const p = new Decimal(amounts[i]);
      const r = new Decimal(rates[i]);
      const one = fin.simpleInterest(p, r, new Decimal(1)).interest;
      const three = fin.simpleInterest(p, r, new Decimal(3)).interest;
      expect(three.minus(one.mul(3)).abs().lte('0.02')).toBe(true);
    }
  });
});
