import { net } from 'electron';
import type { RateTable } from '../shared/api';
import { JsonStore } from './store';

const REFRESH_MS = 6 * 60 * 60 * 1000; // refresh when older than 6h
const SOURCES = [
  {
    name: 'open.er-api.com',
    url: (base: string) => `https://open.er-api.com/v6/latest/${base}`,
    parse: (j: Record<string, unknown>, base: string): RateTable | null => {
      if (j.result !== 'success' || typeof j.rates !== 'object' || !j.rates) return null;
      const unix = Number(j.time_last_update_unix);
      const ts = Number.isFinite(unix) ? new Date(unix * 1000).toISOString() : new Date().toISOString();
      return { base, rates: sanitizeRates(j.rates as Record<string, unknown>), timestamp: ts, source: 'open.er-api.com', fetchedAt: Date.now() };
    },
  },
  {
    name: 'frankfurter.app',
    url: (base: string) => `https://api.frankfurter.dev/v1/latest?from=${base}`,
    parse: (j: Record<string, unknown>, base: string): RateTable | null => {
      if (typeof j.rates !== 'object' || !j.rates || typeof j.date !== 'string') return null;
      const rates = sanitizeRates(j.rates as Record<string, unknown>);
      rates[base] = 1;
      return { base, rates, timestamp: new Date(`${j.date}T16:00:00Z`).toISOString(), source: 'frankfurter.app (ECB)', fetchedAt: Date.now() };
    },
  },
];

function sanitizeRates(raw: Record<string, unknown>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (/^[A-Z]{3}$/.test(k) && typeof v === 'number' && Number.isFinite(v) && v > 0) out[k] = v;
  }
  return out;
}

function validateCache(raw: unknown): Record<string, RateTable> {
  if (!raw || typeof raw !== 'object') return {};
  const out: Record<string, RateTable> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!/^[A-Z]{3}(@\d{4}-\d{2}-\d{2})?$/.test(k) || !v || typeof v !== 'object') continue;
    const t = v as Record<string, unknown>;
    if (typeof t.timestamp !== 'string' || typeof t.fetchedAt !== 'number' || typeof t.rates !== 'object' || !t.rates) continue;
    out[k] = { base: k.slice(0, 3), rates: sanitizeRates(t.rates as Record<string, unknown>), timestamp: t.timestamp, source: String(t.source ?? ''), fetchedAt: t.fetchedAt };
  }
  return out;
}

async function fetchJson(url: string, timeoutMs = 8000): Promise<Record<string, unknown> | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await net.fetch(url, { signal: ctrl.signal, headers: { accept: 'application/json' } });
    if (!res.ok) return null;
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export class RateService {
  private store: JsonStore<Record<string, RateTable>>;
  private cache: Record<string, RateTable> = {};
  private inflight = new Map<string, Promise<RateTable | null>>();
  private loaded: Promise<void>;

  constructor(userData: string) {
    this.store = new JsonStore(userData, 'rates-cache.json', validateCache, () => ({}));
    this.loaded = this.store.read().then((c) => {
      this.cache = c;
    });
  }

  /** Cached table if fresh enough; otherwise fetch (falling back to the cache when offline). */
  async get(base: string): Promise<RateTable | null> {
    await this.loaded;
    const cached = this.cache[base];
    if (cached && Date.now() - cached.fetchedAt < REFRESH_MS) return cached;
    let p = this.inflight.get(base);
    if (!p) {
      p = this.fetch(base).finally(() => this.inflight.delete(base));
      this.inflight.set(base, p);
    }
    const fresh = await p;
    return fresh ?? cached ?? null;
  }

  /**
   * Historical ECB rates (frankfurter.app) for a past date; the response carries the actual
   * business day used, which becomes the table's timestamp. Cached forever: history does not change.
   */
  async getHistorical(base: string, date: string): Promise<RateTable | null> {
    await this.loaded;
    const key = `${base}@${date}`;
    if (this.cache[key]) return this.cache[key];
    let p = this.inflight.get(key);
    if (!p) {
      p = (async () => {
        const json = await fetchJson(`https://api.frankfurter.dev/v1/${date}?from=${base}`);
        if (!json || typeof json.rates !== 'object' || !json.rates || typeof json.date !== 'string') return null;
        const rates = sanitizeRates(json.rates as Record<string, unknown>);
        rates[base] = 1;
        const table: RateTable = { base, rates, timestamp: json.date, source: 'frankfurter.app (ECB)', fetchedAt: Date.now() };
        this.cache[key] = table;
        void this.store.write(this.cache);
        return table;
      })().finally(() => this.inflight.delete(key));
      this.inflight.set(key, p);
    }
    return p;
  }

  private async fetch(base: string): Promise<RateTable | null> {
    for (const src of SOURCES) {
      const json = await fetchJson(src.url(base));
      if (!json) continue;
      const table = src.parse(json, base);
      if (table && Object.keys(table.rates).length > 0) {
        this.cache[base] = table;
        void this.store.write(this.cache);
        return table;
      }
    }
    return null;
  }
}
