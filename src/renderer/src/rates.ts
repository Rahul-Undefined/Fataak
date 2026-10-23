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

  get(from: string, to: string): RateQuote | null {
    const direct = this.tables.get(from);
    if (direct && direct.rates[to]) return this.quote(direct, direct.rates[to]);
    // cross rate through any table containing both
    for (const t of this.tables.values()) {
      if (t.rates[from] && t.rates[to]) return this.quote(t, t.rates[to] / t.rates[from]);
    }
    return null;
  }

  private quote(t: RateTable, rate: number): RateQuote {
    return { rate, timestamp: t.timestamp, source: t.source, stale: Date.now() - t.fetchedAt > STALE_MS };
  }

  request(from: string, to: string): void {
    void to;
    this.fetch(from);
  }

  fetch(base: string): void {
    if (this.pending.has(base)) return;
    const lastFail = this.failed.get(base);
    if (lastFail && Date.now() - lastFail < 30_000) return;
    this.pending.add(base);
    api.rates
      .get(base)
      .then((t) => {
        if (t) {
          this.tables.set(base, t);
          this.failed.delete(base);
          this.onChange();
        } else this.failed.set(base, Date.now());
      })
      .catch(() => this.failed.set(base, Date.now()))
      .finally(() => this.pending.delete(base));
  }
}
