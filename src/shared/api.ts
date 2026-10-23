/** Types shared by main, preload and renderer. No runtime code. */
import type { HistoryLine } from '../engine/history';

export interface Settings {
  /** Electron accelerator string */
  hotkey: string;
  tray: boolean;
  closeToTray: boolean;
  alwaysOnTop: boolean;
}

/** Fn is handled by laptop firmware and never reaches Windows, so Fn+Space cannot be registered; Alt+Space is the closest launcher-style key. */
export const DEFAULT_SETTINGS: Settings = {
  hotkey: 'Alt+Space',
  tray: true,
  closeToTray: true,
  alwaysOnTop: false,
};

export interface RateTable {
  base: string;
  rates: Record<string, number>;
  /** ISO timestamp published by the source */
  timestamp: string;
  source: string;
  /** epoch ms when we fetched it */
  fetchedAt: number;
  /** true when this table was served from disk because the network fetch failed */
  offline?: boolean;
}

export interface SettingsResult {
  settings: Settings;
  /** set when the hotkey could not be registered */
  hotkeyError?: string;
}

export interface FataakApi {
  platform: string;
  version: string;
  history: {
    load(): Promise<HistoryLine[]>;
    save(lines: HistoryLine[]): Promise<void>;
  };
  settings: {
    get(): Promise<SettingsResult>;
    set(patch: Partial<Settings>): Promise<SettingsResult>;
  };
  rates: {
    /** returns the cached/fetched table for the base currency, or null when offline with no cache */
    get(base: string): Promise<RateTable | null>;
    /** ECB rates for a past date (YYYY-MM-DD); null when unavailable */
    getHistorical(base: string, date: string): Promise<RateTable | null>;
  };
  window: {
    hide(): void;
    minimize(): void;
    close(): void;
    toggleMaximize(): void;
    quit(): void;
  };
  clipboard: {
    write(text: string): void;
  };
  /** fired when the window is shown via hotkey/tray; returns an unsubscribe function */
  onShow(cb: () => void): () => void;
}

declare global {
  interface Window {
    fataak?: FataakApi;
  }
}
