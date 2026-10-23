/** Unit tests for the calculation functions themselves (parser, evaluator, finance, formatting, dates). */
import { describe, it, expect } from 'vitest';
import { DateTime } from 'luxon';
import { Decimal } from '@engine/types';
import { parse } from '@engine/parser';
import { evaluate, add, mul, div } from '@engine/evaluator';
import { formatNumber, formatMoney, groupDigits } from '@engine/format';
import { tokenize } from '@engine/tokenizer';
import { tryParseDate } from '@engine/dates';
import { composeNumberWords, normalize } from '@engine/nl/normalize';
import { resolveZone, convertTime } from '@engine/timezone';
import * as fin from '@engine/finance';
import type { EvalContext } from '@engine/types';

const NOW = DateTime.fromISO('2026-10-23T10:00:00', { zone: 'Asia/Kolkata' });
const ctx: EvalContext = { variables: new Map(), previous: [], block: [], rates: { get: () => null }, now: () => NOW, zone: 'Asia/Kolkata' };
const ev = (s: string) => evaluate(parse(s, { variables: new Set(), now: NOW, zone: 'Asia/Kolkata' }), ctx);

describe('tokenizer', () => {
  it('reads Indian and western grouping, decimals, exponents, symbols', () => {
    expect(tokenize('1,00,000.50 + 1e3 ₹5 5%').filter((t) => t.type !== 'space').map((t) => `${t.type}:${t.value}`)).toEqual(['number:100000.50', 'op:+', 'number:1e3', 'currency:₹', 'number:5', 'number:5', 'percent:%']);
  });
  it('never treats a comma without digits after it as grouping', () => {
    expect(tokenize('10, 20').filter((t) => t.type !== 'space').map((t) => t.value)).toEqual(['10', ',', '20']);
  });
});

describe('parser + evaluator', () => {
  it.each([
    ['1 + 2 * 3', '7'],
    ['(1 + 2) * 3', '9'],
    ['2 ^ 10', '1024'],
    ['-2 ^ 2', '-4'],
    ['10 mod 4', '2'],
    ['3 x 4', '12'],
    ['sqrt 16', '4'],
    ['abs(-3)', '3'],
    ['5!', '120'],
    ['10% of 50', '5'],
    ['50 + 10%', '55'],
    ['50 - 10%', '45'],
    ['10% off 50', '45'],
    ['10% on 50', '55'],
    ['$10 + 5', '15'],
    ['5 km in m', '5000'],
    ['2 h + 30 min', '2.5'],
  ])('%s → %s', (expr, expected) => {
    expect(ev(expr).value.toString()).toBe(expected);
  });
  it('type errors are explicit', () => {
    expect(() => ev('today * 2')).toThrow(/multiply/);
    expect(() => ev('5 km + 2 kg')).toThrow(/combine/);
    expect(() => ev('1 / 0')).toThrow(/division by zero/);
    expect(() => ev('5 usd + 2 km')).toThrow();
  });
  it('arithmetic helpers keep kinds and currencies', () => {
    const inr = { kind: 'money' as const, value: new Decimal(100), currency: 'INR' };
    expect(add(inr, { kind: 'number', value: new Decimal(5) }, ctx).currency).toBe('INR');
    expect(mul(inr, { kind: 'percent', value: new Decimal(10) }).value.toString()).toBe('10');
    expect(div(inr, { kind: 'number', value: new Decimal(4) }).value.toString()).toBe('25');
  });
});

describe('finance formulas', () => {
  it('EMI matches the standard reducing-balance formula', () => {
    // 1,000,000 at 8.5% for 240 months: 8678.23 (bank calculators)
    expect(fin.emi(new Decimal(1000000), new Decimal(8.5), 240).emi.toString()).toBe('8678.23');
    expect(fin.emi(new Decimal(500000), new Decimal(9), 60).emi.toString()).toBe('10379.18');
  });
  it('flat-rate loan', () => {
    const r = fin.flatRateLoan(new Decimal(100000), new Decimal(10), 24);
    expect(r.totalInterest.toString()).toBe('20000');
    expect(r.emi.toString()).toBe('5000');
  });
  it('compound interest with frequencies', () => {
    expect(fin.compoundInterest(new Decimal(10000), new Decimal(8), new Decimal(3), 'yearly').total.toString()).toBe('12597.12');
    expect(fin.compoundInterest(new Decimal(10000), new Decimal(8), new Decimal(3), 'quarterly').total.toString()).toBe('12682.42');
    expect(fin.compoundInterest(new Decimal(10000), new Decimal(8), new Decimal(3), 'monthly').total.toString()).toBe('12702.37');
  });
  it('percent difference is symmetric', () => {
    expect(fin.percentDifference(new Decimal(40), new Decimal(50)).toString()).toBe(fin.percentDifference(new Decimal(50), new Decimal(40)).toString());
    expect(fin.percentDifference(new Decimal(40), new Decimal(50)).toString()).toBe('22.22');
  });
  it('rounding is half-up on exact decimals', () => {
    expect(fin.money2(new Decimal('2.675')).toString()).toBe('2.68');
    expect(fin.money2(new Decimal('2.665')).toString()).toBe('2.67');
    expect(fin.money2(new Decimal('-2.675')).toString()).toBe('-2.68');
  });
});

describe('formatting', () => {
  it('groups digits western and Indian style', () => {
    expect(groupDigits('1234567', false)).toBe('1,234,567');
    expect(groupDigits('1234567', true)).toBe('12,34,567');
    expect(groupDigits('123', true)).toBe('123');
  });
  it('trims zeros, honours limits, switches to exponent for extremes', () => {
    expect(formatNumber(new Decimal('2.50'))).toBe('2.5');
    expect(formatNumber(new Decimal('1.23456789'))).toBe('1.2346');
    expect(formatNumber(new Decimal('1e-12'))).toBe('1e-12');
    expect(formatNumber(new Decimal('1e21'))).toBe('1e+21');
    expect(formatNumber(new Decimal('-0'))).toBe('0');
    expect(formatMoney(new Decimal('1234567.891'), 'INR')).toBe('₹12,34,567.89');
    expect(formatMoney(new Decimal('-5'), 'USD')).toBe('-$5');
    expect(formatMoney(new Decimal('5'), 'EUR')).toBe('5 EUR');
  });
});

describe('dates and zones', () => {
  const toks = (s: string) => tokenize(s).filter((t) => t.type !== 'space');
  it('parses literal forms', () => {
    const d = (s: string) => tryParseDate(toks(s), 0, NOW, 'Asia/Kolkata')?.q.date?.toISODate();
    expect(d('14 aug 2026')).toBe('2026-08-14');
    expect(d('aug 14, 2026')).toBe('2026-08-14');
    expect(d('2026-08-14')).toBe('2026-08-14');
    expect(d('14/08/2026')).toBe('2026-08-14');
    expect(d('next friday')).toBe('2026-10-30');
    expect(d('last friday')).toBe('2026-10-16');
    expect(d('last day of february 2028')).toBe('2028-02-29');
    expect(d('10 days ago')).toBe('2026-10-13');
    expect(d('3 days before')).toBe('2026-10-20');
    expect(d('february 2028')).toBe('2028-02-01');
    expect(d('31 feb 2026')).toBeUndefined();
  });
  it('parses times incl. o’clock forms', () => {
    const t = (s: string) => tryParseDate(toks(s), 0, NOW, 'Asia/Kolkata')?.q.date?.toFormat('HH:mm');
    expect(t('6pm')).toBe('18:00');
    expect(t('6:30 pm')).toBe('18:30');
    expect(t('18:30')).toBe('18:30');
    expect(t('10 baje')).toBe('10:00');
    expect(t('13 pm')).toBeUndefined();
  });
  it('fixed abbreviations vs IANA zones', () => {
    expect(resolveZone('est')).toMatchObject({ zone: 'UTC-5', fixed: 'EST' });
    expect(resolveZone('new york')).toMatchObject({ zone: 'America/New_York' });
    const summer = DateTime.fromISO('2026-07-15T10:00:00', { zone: 'Asia/Kolkata' });
    const c = convertTime({ hour: 18, minute: 0, fromRef: resolveZone('ist')!, toRef: resolveZone('new york')!, now: summer });
    expect(c.to.toFormat('HH:mm')).toBe('08:30');
    expect(c.to.isInDST).toBe(true);
  });
});

describe('normaliser', () => {
  it('composes number words', () => {
    expect(composeNumberWords('two thousand five hundred'.split(' '))).toEqual(['2500']);
    expect(composeNumberWords('paanch sau'.split(' '))).toEqual(['500']);
    expect(composeNumberWords('1 lakh 20 hazaar'.split(' '))).toEqual(['120000']);
    expect(composeNumberWords('twenty five'.split(' '))).toEqual(['25']);
    expect(composeNumberWords('sawa sau'.split(' '))).toEqual(['125']);
    expect(composeNumberWords('5 lakh'.split(' '))).toEqual(['5', 'lakh']); // left to the parser
    expect(composeNumberWords('next sat'.split(' '))).toEqual(['next', 'sat']); // weekday, not seven
  });
  it('is prototype-safe', () => {
    expect(() => normalize('constructor toString hasOwnProperty __proto__')).not.toThrow();
  });
});
