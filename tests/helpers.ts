import { DateTime } from 'luxon';
import { evaluateDocument, type LineResult, type RateProvider } from '@engine/index';

/** Fixed test rates (USD base) so currency tests are deterministic. */
export const testRates: RateProvider = {
  get(from, to) {
    const usd: Record<string, number> = { USD: 1, INR: 84, EUR: 0.92, GBP: 0.78, JPY: 150, BDT: 120, AED: 3.67, SGD: 1.34 };
    if (!(from in usd) || !(to in usd)) return null;
    return { rate: usd[to] / usd[from], timestamp: '2026-10-23T00:02:00Z', source: 'test' };
  },
};

export const noRates: RateProvider = { get: () => null };

/** Friday 23 Oct 2026, 10:00 IST */
export const NOW = DateTime.fromISO('2026-10-23T10:00:00', { zone: 'Asia/Kolkata' });

export function run(lines: string | string[], opts: { rates?: RateProvider; now?: DateTime; zone?: string } = {}): LineResult[] {
  const arr = Array.isArray(lines) ? lines : [lines];
  return evaluateDocument(arr, { rates: opts.rates ?? testRates, now: () => opts.now ?? NOW, zone: opts.zone ?? 'Asia/Kolkata' });
}

/** result text of the last line */
export function last(lines: string | string[], opts?: Parameters<typeof run>[1]): string {
  const r = run(lines, opts);
  return r[r.length - 1].display;
}

export function lastNote(lines: string | string[], opts?: Parameters<typeof run>[1]): string | undefined {
  const r = run(lines, opts);
  return r[r.length - 1].note;
}
