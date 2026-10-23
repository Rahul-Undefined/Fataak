import { describe, it, expect } from 'vitest';
import { Decimal } from '@engine/types';
import * as fin from '@engine/finance';
import { last, lastNote, run } from './helpers';

describe('finance formulas (deterministic)', () => {
  it('gst add / remove round half-up to 2 decimals', () => {
    expect(fin.gstAdd(new Decimal(25000), new Decimal(18)).total.toString()).toBe('29500');
    expect(fin.gstRemove(new Decimal(29500), new Decimal(18)).base.toString()).toBe('25000');
    const r = fin.gstRemove(new Decimal(1000), new Decimal(18));
    expect(r.base.toString()).toBe('847.46');
    expect(r.tax.toString()).toBe('152.54');
  });
  it('emi uses the reducing-balance formula', () => {
    const r = fin.emi(new Decimal(500000), new Decimal(9), 60);
    expect(r.emi.toString()).toBe('10379.18');
    expect(r.totalPayment.toString()).toBe('622750.8');
    expect(fin.emi(new Decimal(120000), new Decimal(0), 12).emi.toString()).toBe('10000');
  });
  it('interest', () => {
    expect(fin.simpleInterest(new Decimal(10000), new Decimal(5), new Decimal(2)).interest.toString()).toBe('1000');
    expect(fin.compoundInterest(new Decimal(10000), new Decimal(5), new Decimal(2)).total.toString()).toBe('11025');
    expect(fin.compoundInterest(new Decimal(10000), new Decimal(5), new Decimal(2), 'monthly').total.toString()).toBe('11049.41');
  });
  it('margin vs markup', () => {
    expect(fin.priceFromMarkup(new Decimal(400), new Decimal(25)).toString()).toBe('500');
    expect(fin.priceFromMargin(new Decimal(400), new Decimal(25)).toString()).toBe('533.33');
    expect(fin.marginPct(new Decimal(400), new Decimal(500)).toString()).toBe('20');
    expect(fin.markupPct(new Decimal(400), new Decimal(500)).toString()).toBe('25');
    expect(fin.marginToMarkup(new Decimal(20)).toString()).toBe('25');
  });
});

describe('finance via natural language', () => {
  it('GST', () => {
    expect(last('25000 pe 18% GST add karo')).toBe('29,500');
    expect(last('25000 pe 18% GST lagao')).toBe('29,500');
    expect(last('18% GST on 25000')).toBe('29,500');
    expect(last('₹25000 + 18% gst')).toBe('₹29,500');
    expect(last('29500 inclusive of 18% GST')).toBe('25,000');
    expect(last('reverse gst 18% on 29500')).toBe('25,000');
    expect(last('25000 ka 18% gst')).toBe('4,500');
    expect(lastNote('25000 ka 18% gst')).toContain('total 29,500');
    // ambiguous: no rate → ask, never guess
    const r = run('25000 pe gst add karo');
    expect(r[0].ok).toBe(false);
    expect(r[0].note).toContain('GST rate?');
  });
  it('discount', () => {
    expect(last('20% discount on 1500')).toBe('1,200');
    expect(last('1500 pe 20% chhoot')).toBe('1,200');
    expect(last('1500 pe 20% chhoot do')).toBe('1,200');
    expect(lastNote('20% discount on 1500')).toContain('saved 300');
    expect(run('discount on 1500')[0].note).toContain('discount %?');
  });
  it('increment', () => {
    expect(last(['salary: 50000', 'Increase salary by 12%'])).toBe('56,000');
    expect(last(['salary: ₹50000', 'Meri salary 12% badhao'])).toBe('₹56,000');
    expect(last('decrease 2000 by 25%')).toBe('1,500');
    expect(last('increase 50000 by 5000')).toBe('55,000');
    // undefined variable → hint, no guess
    const r = run('Increase salary by 12%');
    expect(r[0].ok).toBe(false);
    expect(r[0].note).toContain('salary = ?');
  });
  it('profit and loss', () => {
    expect(last('bought at 500 sold at 600')).toBe('100 profit');
    expect(last('500 me kharida 600 me becha')).toBe('100 profit');
    expect(last('500 me kharida 400 me becha')).toBe('100 loss');
    expect(lastNote('bought at 500 sold at 600')).toContain('20% on cost');
    expect(last('20% profit on 500')).toBe('600');
    expect(last('cp 500 sp 450')).toBe('50 loss');
  });
  it('markup and margin', () => {
    expect(last('markup 25% on 400')).toBe('500');
    expect(last('margin 25% on 400')).toBe('533.33');
    expect(last('margin on cost 400 price 500')).toBe('20%');
    expect(last('markup cost 400 price 500')).toBe('25%');
  });
  it('EMI', () => {
    expect(last('emi 5 lakh at 9% for 5 years')).toBe('10,379.18/month');
    expect(last('5 lakh ka loan 9% pe 5 saal emi')).toBe('10,379.18/month');
    expect(last('₹5 lakh loan 9% 60 months emi')).toBe('₹10,379.18/month');
    expect(last('5 lakh ka loan 9% pe 5 saal, emi kitni')).toBe('10,379.18/month');
    expect(run('emi 5 lakh at 9%')[0].note).toContain('tenure?');
    expect(run('emi 5 lakh for 5 years')[0].note).toContain('rate?');
  });
  it('interest', () => {
    expect(last('simple interest on 10000 at 5% for 2 years')).toBe('1,000');
    expect(last('10000 pe 5% byaj 2 saal')).toBe('1,000');
    expect(lastNote('10000 pe 5% byaj 2 saal')).toContain('total 11,000');
    expect(last('compound interest 10000 at 5% for 2 years')).toBe('1,025');
    expect(last('10000 pe 5% chakravriddhi byaj 2 saal monthly')).toBe('1,049.41');
  });
  it('date arithmetic', () => {
    expect(last('today + 30 days')).toBe('22 Nov 2026');
    expect(last('aaj se 45 din baad')).toBe('Mon, 7 Dec 2026');
    expect(last('aaj ke 45 din baad')).toBe('Mon, 7 Dec 2026');
    expect(last('days between 1 jan 2026 and 15 mar 2026')).toBe('73 days');
    expect(last('1 jan 2026 se 15 mar 2026 tak kitne din')).toBe('73 days');
    expect(last('next friday + 2 weeks')).toBe('13 Nov 2026');
    expect(last('15 mar 2026 - 1 jan 2026')).toBe('73 days');
    expect(last('today - 2026-01-01')).toBe('295 days');
  });
});
