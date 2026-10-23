import type { RateProvider, RateQuote } from '../../engine/types';
import type { RateTable } from '../../shared/api';
import { api } from './bridge';

const STALE_MS = 24 * 60 * 60 * 1000;

/**
 * Synchronous rate lookup backed by tables fetched through the main process.
 * Unknown pairs trigger a background fetch; `onChange` lets the editor re-evaluate.
 */
export class RendererRates implements RateProvider {
  private tables = new Map<string, RateTable>();
  private pending = new Set<string>();
  private failed = new Map<string, number>();
  onChange: () => void = () => {};

  get(from: string, to: string, date?: string): RateQuote | null {
    if (date) {
      // historical tables are keyed BASE@date; cross-rate through any table of that date
      const direct = this.tables.get(`${from}@${date}`);
      if (direct && direct.rates[to]) return this.quote(direct, direct.rates[to], true);
      for (const [k, t] of this.tables) {
        if (k.endsWith(`@${date}`) && t.rates[from] && t.rates[to]) return this.quote(t, t.rates[to] / t.rates[from], true);
      }
      return null;
    }
    const direct = this.tables.get(from);
    if (direct && direct.rates[to]) return this.quote(direct, direct.rates[to]);
    for (const [k, t] of this.tables) {
      if (!k.includes('@') && t.rates[from] && t.rates[to]) return this.quote(t, t.rates[to] / t.rates[from]);
    }
    return null;
  }

  private quote(t: RateTable, rate: number, historical = false): RateQuote {
    return { rate, timestamp: t.timestamp, source: t.source, stale: !historical && Date.now() - t.fetchedAt > STALE_MS, offline: !!t.offline };
  }

  /** drop live tables older than the refresh window so a reconnect gets fresh rates (historical tables never expire) */
  expireLive(): void {
    for (const [k, t] of this.tables) {
      if (!k.includes('@') && (t.offline || Date.now() - t.fetchedAt > STALE_MS)) this.tables.delete(k);
    }
  }

  request(from: string, to: string, date?: string): void {
    void to;
    this.fetch(from, date);
  }

  fetch(base: string, date?: string): void {
    const key = date ? `${base}@${date}` : base;
    if (this.pending.has(key)) return;
    const lastFail = this.failed.get(key);
    if (lastFail && Date.now() - lastFail < 30_000) return;
    this.pending.add(key);
    (date ? api.rates.getHistorical(base, date) : api.rates.get(base))
      .then((t) => {
        if (t) {
          this.tables.set(key, t);
          this.failed.delete(key);
          this.onChange();
        } else this.failed.set(key, Date.now());
      })
      .catch(() => this.failed.set(key, Date.now()))
      .finally(() => this.pending.delete(key));
  }
}
