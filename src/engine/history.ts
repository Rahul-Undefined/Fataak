/** 24-hour calculation history: pure functions shared by the renderer and the main process. */

export const HISTORY_TTL_MS = 24 * 60 * 60 * 1000;

export interface HistoryLine {
  id: string;
  text: string;
  /** epoch ms when the line first got content */
  createdAt: number;
}

export function newId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

export function isExpired(line: HistoryLine, now: number, ttl = HISTORY_TTL_MS): boolean {
  return now - line.createdAt >= ttl;
}

/** Drop lines older than the TTL and tidy leading/duplicate blank lines left behind. */
export function pruneExpired(lines: HistoryLine[], now: number, ttl = HISTORY_TTL_MS): HistoryLine[] {
  const kept = lines.filter((l) => !isExpired(l, now, ttl));
  const out: HistoryLine[] = [];
  for (const l of kept) {
    const blank = l.text.trim() === '';
    const prevBlank = out.length === 0 || out[out.length - 1].text.trim() === '';
    if (blank && prevBlank) continue;
    out.push(l);
  }
  return out;
}

/** Validate a stored history document (untrusted JSON from disk). */
export function sanitizeLines(input: unknown): HistoryLine[] {
  if (!Array.isArray(input)) return [];
  const out: HistoryLine[] = [];
  for (const item of input) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    if (typeof o.text !== 'string' || typeof o.createdAt !== 'number' || !Number.isFinite(o.createdAt)) continue;
    const id = typeof o.id === 'string' && o.id.length <= 32 ? o.id : newId();
    out.push({ id, text: o.text.slice(0, 2000), createdAt: o.createdAt });
  }
  return out.slice(0, 5000);
}

/** Longest-common-subsequence alignment of old lines to new texts so unchanged lines keep their id/createdAt. */
export function syncLines(prev: HistoryLine[], texts: string[], now: number): HistoryLine[] {
  const n = prev.length;
  const m = texts.length;
  if (n === 0) return texts.map((t) => ({ id: newId(), text: t, createdAt: now }));
  // DP table of LCS lengths (small documents, O(n·m) is fine)
  const dp: Uint16Array[] = [];
  for (let i = 0; i <= n; i++) dp.push(new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = prev[i].text === texts[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const out: HistoryLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (prev[i].text === texts[j]) {
      out.push(prev[i]);
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      // old line removed or edited: if the next new line is not matched elsewhere, treat as an edit (keep timestamp)
      if (dp[i + 1][j + 1] === dp[i + 1][j] && dp[i + 1][j + 1] === dp[i][j + 1]) {
        out.push({ ...prev[i], text: texts[j], createdAt: prev[i].text.trim() === '' ? now : prev[i].createdAt });
        i++;
        j++;
      } else i++;
    } else {
      out.push({ id: newId(), text: texts[j], createdAt: now });
      j++;
    }
  }
  while (j < m) {
    out.push({ id: newId(), text: texts[j], createdAt: now });
    j++;
  }
  return out;
}
