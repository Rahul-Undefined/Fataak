import { describe, it, expect } from 'vitest';
import { last, lastNote, run } from './helpers';

describe('implicit definitions from visible lines', () => {
  const doc = ['rahul Rs 100', 'rohit Rs 50', 'Rahul + Rohit', 'Rahul + Rs 150', 'Rahul / 5', 'Rahul + Rohit * 2', 'rahul Rs in USD'];

  it('"name value" lines define the name', () => {
    const r = run(doc);
    expect(r.map((x) => x.display)).toEqual(['₹100', '₹50', '₹150', '₹250', '₹20', '₹200', '$1.19']);
    expect(r[0].label).toBe('rahul');
    expect(r[0].spans[0]).toMatchObject({ start: 0, end: 5, cls: 'label' });
  });

  it('works with plain numbers, multi-word names and redefinition', () => {
    expect(last(['rent 15000', 'food 6000', 'rent + food'])).toBe('21,000');
    expect(last(['office rent ₹15000', 'office rent * 12'])).toBe('₹1,80,000');
    expect(last(['coffee $4.5', 'coffee 5', 'coffee * 2'])).toBe('10');
  });

  it('context disappears when the defining line is removed', () => {
    expect(run(['rahul Rs 100', 'rahul * 2'])[1].display).toBe('₹200');
    const r = run(['', 'rahul * 2']);
    expect(r[1].ok).toBe(false);
    expect(r[1].note).toContain('rahul = ?');
  });

  it('does not define names from keywords, prose or incomplete expressions', () => {
    expect(run('increase 500 by 10%')[0].display).toBe('550');
    expect(run('rahul + 5')[0].ok).toBe(false);
    expect(run('call rahul 5pm')[0].ok).toBe(false);
    expect(run(['salary: 50000', 'salary 12% badhao'])[1].display).toBe('56,000');
    expect(run('usd 100')[0].display).toBe('$100');
  });
});

describe('dated currency conversion', () => {
  it('"10 days ago" uses the historical rate for that date', () => {
    expect(last('1 usd to inr 10 days ago')).toBe('₹80');
    expect(last('1 usd in inr')).toBe('₹84');
    expect(lastNote('1 usd to inr 10 days ago')).toContain('on 13 Oct 2026');
    expect(last('100 usd in inr on 13 oct 2026')).toBe('₹8,000');
    expect(last('100 usd in inr as of 13 oct 2026')).toBe('₹8,000');
  });
  it('a date with no rate shows a hint, never a guess', () => {
    const r = run('1 usd to inr 3 days ago');
    expect(r[0].ok).toBe(false);
    expect(r[0].note).toContain('2026-10-20');
  });
  it('"N days ago" also works as a plain date', () => {
    expect(last('10 days ago')).toBe('Tue, 13 Oct 2026');
    expect(last('2 weeks ago + 1 day')).toBe('Sat, 10 Oct 2026');
  });
});
