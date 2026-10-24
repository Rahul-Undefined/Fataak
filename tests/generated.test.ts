/**
 * Generated adversarial benchmark. Cases come from tests/gen/generate.py (independent Python oracle);
 * this file runs each one through the real engine (evaluateDocument) and records every outcome in
 * tests/gen/results.json with a pass/fail status and an error category.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { run } from './helpers';

interface Case {
  id: string;
  cat: string;
  input: string | string[];
  expect: { type: 'num'; value: string; tol: string; suffix?: string | null } | { type: 'exact'; display: string } | { type: 'error' } | { type: 'contains'; parts: string[] } | { type: 'not-equal'; display_num: string } | { type: 'any'; displays: string[] } | { type: 'anynum'; values: string[]; tol: string };
  note?: string;
}
interface Outcome {
  id: string;
  cat: string;
  input: string | string[];
  expected: string;
  actual: string;
  note?: string;
  pass: boolean;
  category: 'ok' | 'wrong-value' | 'wrong-format' | 'error-instead-of-answer' | 'answer-instead-of-error' | 'wrong-text';
}

const dir = join(__dirname, 'gen');
const cases: Case[] = JSON.parse(readFileSync(join(dir, 'cases.json'), 'utf8'));
const outcomes: Outcome[] = [];

function firstNumber(display: string): number | null {
  const cleaned = display.replace(/[₹$€£,]/g, '').replace(/^x\s*=\s*/, '');
  const m = /-?\d+(?:\.\d+)?/.exec(cleaned);
  return m ? parseFloat(m[0]) : null;
}

function judge(c: Case): Outcome {
  const res = run(c.input);
  const r = res[res.length - 1];
  const actual = r.ok ? r.display : `ERR: ${r.display}`;
  const base = { id: c.id, cat: c.cat, input: c.input, actual, note: c.note };
  const e = c.expect;
  if (e.type === 'error') {
    const pass = !r.ok || r.isText;
    return { ...base, expected: 'error/clarification', pass, category: pass ? 'ok' : 'answer-instead-of-error' };
  }
  if (e.type === 'not-equal') {
    const n = r.ok ? firstNumber(r.display) : null;
    const pass = !r.ok || n === null || Math.abs(n - parseFloat(e.display_num)) > 0.01;
    return { ...base, expected: `not ${e.display_num}`, pass, category: pass ? 'ok' : 'wrong-value' };
  }
  if (!r.ok) return { ...base, expected: e.type === 'num' ? e.value : e.type === 'exact' ? e.display : e.type === 'any' ? e.displays.join(' | ') : e.type === 'anynum' ? e.values.join(' | ') : e.parts.join(' & '), pass: false, category: 'error-instead-of-answer' };
  if (e.type === 'anynum') {
    const n = firstNumber(r.display);
    const pass = n !== null && e.values.some((v) => Math.abs(n - parseFloat(v)) <= parseFloat(e.tol) + 1e-9);
    return { ...base, expected: e.values.join(' | '), pass, category: pass ? 'ok' : 'wrong-value' };
  }
  if (e.type === 'any') {
    const pass = e.displays.includes(r.display);
    return { ...base, expected: e.displays.join(' | '), pass, category: pass ? 'ok' : 'wrong-value' };
  }
  if (e.type === 'exact') {
    const pass = r.display === e.display;
    return { ...base, expected: e.display, pass, category: pass ? 'ok' : firstNumber(r.display) !== null && firstNumber(r.display) === firstNumber(e.display) ? 'wrong-format' : 'wrong-value' };
  }
  if (e.type === 'contains') {
    const hay = `${r.display} ${r.note ?? ''}`;
    const pass = e.parts.every((p) => hay.includes(p));
    return { ...base, expected: e.parts.join(' & '), pass, category: pass ? 'ok' : 'wrong-text' };
  }
  const n = firstNumber(r.display);
  const want = parseFloat(e.value);
  const tol = parseFloat(e.tol);
  const numOk = n !== null && Math.abs(n - want) <= tol + 1e-9;
  const sufOk = !e.suffix || r.display.includes(e.suffix);
  const pass = numOk && sufOk;
  return { ...base, expected: `${e.value}${e.suffix ? ' ' + e.suffix : ''}`, pass, category: pass ? 'ok' : numOk ? 'wrong-format' : 'wrong-value' };
}

describe('generated adversarial benchmark', () => {
  for (const c of cases) {
    it(`${c.id} ${Array.isArray(c.input) ? c.input.join(' | ') : c.input}`, () => {
      const o = judge(c);
      outcomes.push(o);
      expect(o.actual, `${o.category} (expected ${o.expected})`).toSatisfy(() => o.pass);
    });
  }
});

afterAll(() => {
  const byCat: Record<string, { total: number; pass: number }> = {};
  for (const o of outcomes) {
    const k = o.cat;
    byCat[k] ??= { total: 0, pass: 0 };
    byCat[k].total++;
    if (o.pass) byCat[k].pass++;
  }
  const summary = { total: outcomes.length, pass: outcomes.filter((o) => o.pass).length, byCategory: byCat, byError: outcomes.reduce<Record<string, number>>((m, o) => ((m[o.category] = (m[o.category] ?? 0) + 1), m), {}) };
  writeFileSync(join(dir, 'results.json'), JSON.stringify({ summary, outcomes }, null, 1), 'utf8');
  writeFileSync(join(dir, 'failures.txt'), outcomes.filter((o) => !o.pass).map((o) => `${o.id} [${o.category}] ${Array.isArray(o.input) ? o.input.join(' | ') : o.input}\n   expected: ${o.expected}\n   actual:   ${o.actual}${o.note ? `\n   note: ${o.note}` : ''}`).join('\n'), 'utf8');
});
