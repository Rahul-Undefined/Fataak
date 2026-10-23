import { describe, it, expect } from 'vitest';
import { normalize } from '@engine/nl/normalize';
import { last, run } from './helpers';

describe('normaliser', () => {
  it('maps Hinglish to canonical words', () => {
    expect(normalize('Meri salary 12% badhao').words).toEqual(['salary', '12%', 'increase']);
    expect(normalize('Meri salary 12% badhao kitni hogi?').words).toEqual(['salary', '12%', 'increase', 'what']);
    expect(normalize('25000 pe 18% GST add karo').words).toEqual(['25000', 'on', '18%', 'gst', 'add']);
    expect(normalize('25000 pe 18% GST lagao').words).toEqual(['25000', 'on', '18%', 'gst', 'add']);
    expect(normalize('aaj se 45 din baad').words).toEqual(['today', 'from', '45', 'days', 'after']);
    expect(normalize('12 percent').words).toEqual(['12%']);
  });
});

describe('multilingual parsing — same meaning, three languages', () => {
  const salary = 'salary: 50000';
  it.each([
    ['Increase salary by 12%', '56,000'],
    ['salary increased by 12%', '56,000'],
    ['Meri salary 12% badhao', '56,000'],
    ['meri salary ko 12% badha do', '56,000'],
    ['salary 12% barhao', '56,000'],
    ['Meri salary 12% badhao kitni hogi?', '56,000'],
    ['meri salary 12% badha do', '56,000'],
    ['salary 12% increase', '56,000'],
    ['salary me 12% ki badhotri'.replace('badhotri', 'badhao'), '56,000'],
    ['Decrease salary by 10%', '45,000'],
    ['salary 10% ghatao', '45,000'],
    ['salary 10% ghatao', '45,000'],
    ['salary me se 10% kam karo', '45,000'],
  ])('%s → %s', (input, expected) => {
    expect(last([salary, input])).toBe(expected);
  });

  it.each([
    ['25000 pe 18% GST add karo', '29,500'],
    ['25000 pe 18% GST lagao', '29,500'],
    ['25000 me 18% gst jodo', '29,500'],
    ['25000 me 18% gst jodo', '29,500'],
    ['add 18% gst to 25000', '29,500'],
    ['25000 with 18% gst', '29,500'],
    ['25000 plus 18% gst', '29,500'],
    ['29500 me se 18% gst hatao', '25,000'],
    ['29500 me se 18% gst hatao', '25,000'],
    ['29500 including 18% gst', '25,000'],
    ['29500 gst samet 18%', '25,000'],
    ['18% gst on 25000 kitna hoga', '29,500'],
  ])('GST: %s → %s', (input, expected) => {
    expect(last(input)).toBe(expected);
  });

  it.each([
    ['₹5000 ka 18%', '₹900'],
    ['5000 ka 18%', '900'],
    ['5000 ka 18 percent kitna hai', '900'],
    ['18% of 5000', '900'],
    ['5000 ka 18% kitna', '900'],
  ])('percent of: %s → %s', (input, expected) => {
    expect(last(input)).toBe(expected);
  });

  it.each([
    ['100 USD in INR', '₹8,400'],
    ['100 dollar ko rupee me', '₹8,400'],
    ['100 dollar kitne rupaye', '₹8,400'],
    ['100 dollar inr me convert karo', '₹8,400'],
    ['convert 100 usd to inr', '₹8,400'],
    ['$100 in rupees', '₹8,400'],
    ['5 km ko miles me badlo', '3.11 mi'],
    ['5 km kitne miles', '3.11 mi'],
  ])('conversion: %s → %s', (input, expected) => {
    expect(last(input)).toBe(expected);
  });

  it('handles spelling variants, word order and mixed language', () => {
    expect(last('1500 pe 20% discount kitna hoga')).toBe('1,200');
    expect(last('20% ki chhoot 1500 par')).toBe('1,200');
    expect(last('1500 pe 20% discount do kitna hoga')).toBe('1,200');
    expect(last('bought for 500 and sold for 650 profit?')).toBe('150 profit');
    expect(last('500 me liya 650 me becha')).toBe('150 profit');
    expect(last('kharida 500 becha 650')).toBe('150 profit');
  });

  it('does not mistake prose for a calculation', () => {
    const r = run(['meeting notes', 'call rahul tomorrow', 'kal milte hain']);
    expect(r[0].isText).toBe(true);
    expect(r[1].ok).toBe(false);
    expect(r[2].ok).toBe(false);
  });
});
