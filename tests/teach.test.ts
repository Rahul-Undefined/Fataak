/** Teach FATAAK rules (with number slots) and the offline "did you mean" suggester. */
import { describe, it, expect } from 'vitest';
import { run } from './helpers';
import { suggest, ruleProblem, previewRule, sanitizeRules, setTeachRules, applyTeachRules } from '@engine/index';

const rules = (xs: [string, string][]) => xs.map(([from, to]) => ({ from, to, createdAt: 1 }));

describe('teach rules', () => {
  it('a phrase rule rewrites the line before anything else', () => {
    const r = run(['mera tax kitna 15 lakh salary'], { rules: rules([['mera tax kitna', 'income tax on']]) });
    expect(r[0].display).toBe('97,500');
    expect(r[0].note).toContain('taught');
  });
  it('numbers in the taught phrase become slots', () => {
    const rs = rules([['15 lakh pe mera tax', 'income tax on 15 lakh salary']]);
    expect(run(['9 lakh pe mera tax'], { rules: rs })[0].display).toBe('0');
    expect(run(['25 lakh pe mera tax'], { rules: rs })[0].display).toBe('319,800');
    expect(run(['20 lakh pe mera tax'], { rules: rs })[0].display).toBe('192,400');
  });
  it('rules do not fire inside other words and are case-insensitive', () => {
    const rs = rules([['tax', 'income tax on']]);
    expect(run(['syntax 5 lakh'], { rules: rs })[0].display).toBe('500,000');
    expect(run(['TAX 15 lakh'], { rules: rs })[0].display).toBe('109,200');
  });
  it('longest phrase wins; several rules can fire', () => {
    const rs = rules([['kharcha', 'emi'], ['ghar ka kharcha', 'emi'], ['saal', 'years']]);
    expect(run(['ghar ka kharcha 5 lakh at 9% for 5 saal'], { rules: rs })[0].display).toBe('10,379.18/month');
  });
  it('rules are cleared when an empty list is passed', () => {
    setTeachRules(rules([['abc', 'emi']]));
    expect(applyTeachRules('abc 1').applied).toHaveLength(1);
    setTeachRules([]);
    expect(applyTeachRules('abc 1').applied).toHaveLength(0);
  });
  it('validation explains what is wrong', () => {
    expect(ruleProblem('', 'x')).toMatch(/type/);
    expect(ruleProblem('abc', 'abc')).toMatch(/same/);
    expect(ruleProblem('mera tax', 'income tax on 15 lakh')).toMatch(/numbers/);
    expect(ruleProblem('mera tax 15', 'income tax on 20')).toMatch(/same numbers/);
    expect(ruleProblem('123', '456')).toMatch(/words/);
    expect(ruleProblem('mera tax 15 lakh', 'income tax on 15 lakh salary')).toBeNull();
  });
  it('preview applies one rule to a sample', () => {
    expect(previewRule('mera tax 15 lakh', 'income tax on 15 lakh salary', 'mera tax 9 lakh')).toBe('income tax on 9 lakh salary');
    expect(previewRule('mera tax', 'income tax on', 'kuch aur')).toBeNull();
  });
  it('sanitize drops junk and duplicates', () => {
    const out = sanitizeRules([{ from: ' A ', to: 'b' }, { from: 'a', to: 'c' }, 5, { from: 'x' }, { from: '', to: 'y' }]);
    expect(out).toEqual([{ from: 'a', to: 'b', createdAt: expect.any(Number) }]);
  });
});

describe('did you mean', () => {
  const first = (s: string) => suggest(s)[0]?.text;
  it('carries the typed numbers into a known shape', () => {
    expect(first('tax kitna lagega 15 lakh salary pe')).toBe('income tax on 15 lakh salary');
    expect(first('mujhe 5 lakh ka loan chahiye 9 percent 5 saal')).toBe('emi 5 lakh at 9% for 5 years');
    expect(first('sip kitna banega 5000 12 percent 10 saal')).toBe('sip 5000 at 12% for 10 years');
    expect(first('480 ka 25 percent nikalo')).toBe('25% of 480');
  });
  it('tolerates typos in long keywords', () => {
    expect(first('incme tax 15 lakh salry')).toBe('income tax on 15 lakh salary');
    expect(first('calries to lose 0.5 kg a week')).toBe('calories to lose 0.5 kg a week');
  });
  it('says nothing for chat', () => {
    expect(suggest('hello how are you')).toEqual([]);
    expect(suggest('')).toEqual([]);
  });
  it('never suggests the line itself and returns at most three', () => {
    expect(suggest('income tax on 15 lakh salary').map((s) => s.text)).not.toContain('income tax on 15 lakh salary');
    expect(suggest('emi loan interest tax gst 5 lakh').length).toBeLessThanOrEqual(3);
  });
});
