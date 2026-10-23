import { describe, it, expect } from 'vitest';
import { HISTORY_TTL_MS, isExpired, pruneExpired, sanitizeLines, syncLines, type HistoryLine } from '@engine/history';

const H = 60 * 60 * 1000;
const line = (text: string, ageMs: number, now: number, id = text): HistoryLine => ({ id, text, createdAt: now - ageMs });

describe('24-hour history expiry', () => {
  const now = Date.parse('2026-10-23T10:00:00Z');

  it('expires entries exactly 24h after creation', () => {
    expect(isExpired(line('a', 24 * H - 1, now), now)).toBe(false);
    expect(isExpired(line('a', 24 * H, now), now)).toBe(true);
    expect(HISTORY_TTL_MS).toBe(24 * H);
  });

  it('prunes expired lines and keeps the rest in order', () => {
    const lines = [line('old1', 30 * H, now), line('old2', 25 * H, now), line('fresh1', 2 * H, now), line('fresh2', 1 * H, now)];
    expect(pruneExpired(lines, now).map((l) => l.text)).toEqual(['fresh1', 'fresh2']);
  });

  it('collapses blank lines left behind by expiry', () => {
    const lines = [line('', 30 * H, now, 'b0'), line('old', 30 * H, now), line('', 30 * H, now, 'b1'), line('', 3 * H, now, 'b2'), line('new', 1 * H, now)];
    expect(pruneExpired(lines, now).map((l) => l.text)).toEqual(['new']);
  });

  it('keeps everything when nothing is expired', () => {
    const lines = [line('a', 1 * H, now), line('', 1 * H, now, 'b'), line('c', 0, now)];
    expect(pruneExpired(lines, now)).toEqual(lines);
  });

  it('is reliable across restarts: expiry is based on stored timestamps, not session time', () => {
    const stored = JSON.parse(JSON.stringify([line('x', 23 * H, now)]));
    const later = now + 2 * H;
    expect(pruneExpired(sanitizeLines(stored), later)).toEqual([]);
  });
});

describe('sanitizeLines (untrusted JSON from disk)', () => {
  it('drops malformed entries and clamps sizes', () => {
    const out = sanitizeLines([{ id: 'a', text: 'ok', createdAt: 1 }, { text: 5, createdAt: 1 }, null, 'x', { id: 'b', text: 'y'.repeat(5000), createdAt: 2 }]);
    expect(out.length).toBe(2);
    expect(out[1].text.length).toBe(2000);
    expect(sanitizeLines('garbage')).toEqual([]);
  });
});

describe('syncLines keeps creation time for unchanged/edited lines', () => {
  const t0 = 1000;
  const t1 = 5000;
  it('typing on an existing line keeps its createdAt', () => {
    const prev = [{ id: 'a', text: '2 + 2', createdAt: t0 }];
    const next = syncLines(prev, ['2 + 25'], t1);
    expect(next[0].id).toBe('a');
    expect(next[0].createdAt).toBe(t0);
  });
  it('new lines get the current time; existing lines keep theirs', () => {
    const prev = [{ id: 'a', text: 'first', createdAt: t0 }];
    const next = syncLines(prev, ['first', 'second'], t1);
    expect(next.map((l) => l.createdAt)).toEqual([t0, t1]);
  });
  it('deleting a line removes only that line', () => {
    const prev = [
      { id: 'a', text: 'first', createdAt: t0 },
      { id: 'b', text: 'second', createdAt: t0 + 1 },
      { id: 'c', text: 'third', createdAt: t0 + 2 },
    ];
    const next = syncLines(prev, ['first', 'third'], t1);
    expect(next.map((l) => l.id)).toEqual(['a', 'c']);
  });
});
