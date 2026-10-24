/** Types shared by main, preload and renderer. No runtime code. */
import type { HistoryLine } from '../engine/history';
import type { TeachRule } from '../engine/teach';
import { DEFAULT_EDITOR_FONT, DEFAULT_TINT, DEFAULT_UI_FONT } from './fonts';

export interface Settings {
  /** Electron accelerator string */
  hotkey: string;
  tray: boolean;
  closeToTray: boolean;
  alwaysOnTop: boolean;
  /** desktop widget: pinned in place, no taskbar entry, cannot be moved, minimised or closed from the UI */
  widgetMode: boolean;
  /** Moon (dark), Sun (light) or Star (glass over the desktop, tinted) */
  theme: 'dark' | 'light' | 'star';
  /** glass tint for the Star theme, #rrggbb */
  tint: string;
  /** keys from shared/fonts.ts */
  uiFont: string;
  editorFont: string;
  /** the first-run tutorial has been watched or skipped */
  tutorialSeen: boolean;
  /** the version whose release notes were shown last; a newer app shows "What's new" once */
  lastSeenVersion: string;
  /** GitHub repository ("owner/name") whose Releases carry the FATAAK zips; "Check for updates" reads it */
  updateRepo: string;
}

/** Fn is handled by laptop firmware and never reaches Windows, so Fn+Space cannot be registered; Alt+Space is the closest launcher-style key. */
export const DEFAULT_SETTINGS: Settings = {
  hotkey: 'Alt+Space',
  tray: true,
  closeToTray: true,
  alwaysOnTop: false,
  widgetMode: false,
  theme: 'dark',
  tint: DEFAULT_TINT,
  uiFont: DEFAULT_UI_FONT,
  editorFont: DEFAULT_EDITOR_FONT,
  tutorialSeen: false,
  lastSeenVersion: '',
  updateRepo: 'Rahul-Undefined/Fataak',
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

export interface AppInfo {
  version: string;
  /** ISO date of the build */
  buildDate: string;
  platform: string;
  /** true when running packaged (not from source) */
  packaged: boolean;
  /** the system can draw acrylic glass behind the window (Windows 11 22H2+) */
  glass: boolean;
  /** outcome of the update that restarted this instance ("updated to 1.2.0"), once */
  lastUpdate?: string;
}

export interface UpdateCheck {
  current: string;
  latest?: string;
  /** download URL of the Windows zip asset */
  url?: string;
  size?: number;
  /** "up to date", "update available: x.y.z", or why the check could not run */
  status: string;
  /** true when this build can install the update itself (packaged, Windows) */
  canInstall: boolean;
}

export interface UpdateInstall {
  ok: boolean;
  status: string;
}

export interface UpdateProgress {
  received: number;
  total: number;
  phase: 'downloading' | 'extracting' | 'restarting';
}

/** a question FATAAK could not answer, kept locally until the user shares it */
export interface Unanswered {
  text: string;
  /** the hint FATAAK showed, if any */
  hint: string;
  count: number;
  firstAt: number;
  lastAt: number;
  version: string;
}

export interface FataakApi {
  platform: string;
  version: string;
  app: {
    info(): Promise<AppInfo>;
    checkUpdate(): Promise<UpdateCheck>;
    /** downloads the zip from GitHub, stages it, restarts FATAAK on the new files */
    installUpdate(url: string, version: string): Promise<UpdateInstall>;
    onUpdateProgress(cb: (p: UpdateProgress) => void): () => void;
  };
  /** "Teach FATAAK" rules, stored in teach.json next to the settings */
  teach: {
    load(): Promise<TeachRule[]>;
    save(rules: TeachRule[]): Promise<TeachRule[]>;
  };
  /** questions FATAAK could not answer, stored in unanswered.json; exported as CSV on request */
  unanswered: {
    load(): Promise<Unanswered[]>;
    add(items: { text: string; hint: string }[]): Promise<number>;
    clear(): Promise<void>;
    /** opens a save dialog and writes the CSV; returns the path, or null when cancelled */
    exportCsv(): Promise<string | null>;
    /** the CSV text (for the clipboard) */
    csv(): Promise<string>;
  };
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
