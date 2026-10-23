/**
 * Access to the preload API. When running in a plain browser (vite dev for UI checks),
 * a localStorage/fetch shim stands in so the UI can be exercised without Electron.
 */
import type { FataakApi, RateTable, Settings, SettingsResult } from '../../shared/api';
import { DEFAULT_SETTINGS } from '../../shared/api';
import { sanitizeLines, type HistoryLine } from '../../engine/history';

function browserShim(): FataakApi {
  const key = 'fataak.history';
  const skey = 'fataak.settings';
  let settings: Settings = { ...DEFAULT_SETTINGS, ...(JSON.parse(localStorage.getItem(skey) ?? '{}') as Partial<Settings>) };
  const tables = new Map<string, RateTable>();
  return {
    platform: 'browser',
    version: 'dev',
    history: {
      load: async () => sanitizeLines(JSON.parse(localStorage.getItem(key) ?? '[]')),
      save: async (lines: HistoryLine[]) => localStorage.setItem(key, JSON.stringify(lines)),
    },
    settings: {
      get: async (): Promise<SettingsResult> => ({ settings }),
      set: async (patch) => {
        settings = { ...settings, ...patch };
        localStorage.setItem(skey, JSON.stringify(settings));
        return { settings };
      },
    },
    rates: {
      get: async (base) => {
        const hit = tables.get(base);
        if (hit) return hit;
        try {
          const res = await fetch(`https://open.er-api.com/v6/latest/${base}`);
          const j = (await res.json()) as { result: string; rates: Record<string, number>; time_last_update_unix: number };
          if (j.result !== 'success') return null;
          const t: RateTable = { base, rates: j.rates, timestamp: new Date(j.time_last_update_unix * 1000).toISOString(), source: 'open.er-api.com', fetchedAt: Date.now() };
          tables.set(base, t);
          return t;
        } catch {
          return null;
        }
      },
    },
    window: { hide: () => {}, minimize: () => {}, close: () => {}, toggleMaximize: () => {}, quit: () => {} },
    clipboard: { write: (text) => void navigator.clipboard?.writeText(text) },
    onShow: () => () => {},
  };
}

export const api: FataakApi = window.fataak ?? browserShim();
export const isElectron = !!window.fataak;
