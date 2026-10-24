/**
 * The local log of questions FATAAK could not answer. Pure functions shared by the main process (file store,
 * CSV export) and the browser shim. Nothing leaves the machine unless the user exports the CSV.
 */
import type { Unanswered } from '../shared/api';

const MAX = 1000;

export function sanitizeUnanswered(raw: unknown): Unanswered[] {
  if (!Array.isArray(raw)) return [];
  const out: Unanswered[] = [];
  for (const r of raw.slice(0, MAX)) {
    if (!r || typeof r !== 'object') continue;
    const o = r as Record<string, unknown>;
    if (typeof o.text !== 'string' || !o.text.trim()) continue;
    out.push({
      text: o.text.slice(0, 500),
      hint: typeof o.hint === 'string' ? o.hint.slice(0, 300) : '',
      count: Number.isFinite(o.count) && (o.count as number) > 0 ? Math.floor(o.count as number) : 1,
      firstAt: Number.isFinite(o.firstAt) ? (o.firstAt as number) : 0,
      lastAt: Number.isFinite(o.lastAt) ? (o.lastAt as number) : 0,
      version: typeof o.version === 'string' ? o.version.slice(0, 20) : '',
    });
  }
  return out;
}

/** text keys ignore case and spacing so "Mera TAX  kitna" and "mera tax kitna" are one entry */
function keyOf(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

/** returns the same array when nothing changed */
export function mergeUnanswered(cur: Unanswered[], items: { text: string; hint: string }[], version: string, now: number): Unanswered[] {
  let changed = false;
  const next = cur.slice();
  const index = new Map(next.map((u, i) => [keyOf(u.text), i]));
  for (const it of items) {
    const text = (it.text ?? '').trim();
    if (!text) continue;
    const k = keyOf(text);
    const i = index.get(k);
    if (i !== undefined) {
      // same question again: only the count and the time move (at most once a minute, so typing is not counted twice)
      if (now - next[i].lastAt < 60_000) continue;
      next[i] = { ...next[i], count: next[i].count + 1, lastAt: now, hint: it.hint || next[i].hint };
      changed = true;
      continue;
    }
    next.push({ text: text.slice(0, 500), hint: (it.hint ?? '').slice(0, 300), count: 1, firstAt: now, lastAt: now, version });
    index.set(k, next.length - 1);
    changed = true;
  }
  if (!changed) return cur;
  // keep the newest when the log is full
  return next.length > MAX ? next.slice(next.length - MAX) : next;
}

function csvCell(s: string): string {
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** one row per question; columns readable in Excel or Sheets */
export function unansweredCsv(items: Unanswered[]): string {
  const iso = (t: number) => (t ? new Date(t).toISOString().slice(0, 19).replace('T', ' ') : '');
  const rows = [['question', 'times asked', 'first asked', 'last asked', 'hint shown', 'fataak version', 'what I expected (fill in)']];
  for (const u of items.slice().sort((a, b) => b.lastAt - a.lastAt)) rows.push([u.text, String(u.count), iso(u.firstAt), iso(u.lastAt), u.hint, u.version, '']);
  return rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
