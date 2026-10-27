import { contextBridge, ipcRenderer } from 'electron';
import type { FataakApi, Settings } from '../shared/api';
import type { HistoryLine } from '../engine/history';
import { sanitizeRules } from '../engine/teach';
import { FONTS, HEX_RE } from '../shared/fonts';

/* ---- argument validation: the renderer is sandboxed and untrusted ---- */
function assertString(v: unknown, name: string, max = 10000): string {
  if (typeof v !== 'string' || v.length > max) throw new TypeError(`${name} must be a string (≤${max})`);
  return v;
}
function validateLines(v: unknown): HistoryLine[] {
  if (!Array.isArray(v) || v.length > 5000) throw new TypeError('lines must be an array');
  return v.map((l) => {
    if (!l || typeof l !== 'object') throw new TypeError('bad line');
    const o = l as Record<string, unknown>;
    return { id: assertString(o.id, 'id', 32), text: assertString(o.text, 'text', 2000), createdAt: Number(o.createdAt) };
  });
}
function validateSettingsPatch(v: unknown): Partial<Settings> {
  if (!v || typeof v !== 'object') throw new TypeError('settings patch must be an object');
  const o = v as Record<string, unknown>;
  const out: Partial<Settings> = {};
  if ('hotkey' in o) out.hotkey = assertString(o.hotkey, 'hotkey', 64);
  if ('updateRepo' in o) out.updateRepo = assertString(o.updateRepo, 'updateRepo', 100);
  if ('lastSeenVersion' in o) out.lastSeenVersion = assertString(o.lastSeenVersion, 'lastSeenVersion', 20);
  if ('theme' in o) {
    if (o.theme !== 'dark' && o.theme !== 'light' && o.theme !== 'star') throw new TypeError('theme must be dark, light or star');
    out.theme = o.theme;
  }
  if ('tint' in o) {
    const t = assertString(o.tint, 'tint', 7);
    if (!HEX_RE.test(t)) throw new TypeError('tint must be #rrggbb');
    out.tint = t.toLowerCase();
  }
  for (const k of ['uiFont', 'editorFont'] as const) {
    if (k in o) {
      const f = assertString(o[k], k, 40);
      if (!FONTS.some((x) => x.key === f && x.kind === (k === 'uiFont' ? 'ui' : 'mono'))) throw new TypeError(`${k}: unknown font`);
      out[k] = f;
    }
  }
  for (const k of ['tray', 'closeToTray', 'alwaysOnTop', 'widgetMode', 'tutorialSeen', 'startup', 'launcher', 'hideFromCapture'] as const) {
    if (k in o) {
      if (typeof o[k] !== 'boolean') throw new TypeError(`${k} must be boolean`);
      out[k] = o[k] as boolean;
    }
  }
  return out;
}

function validatePinned(v: unknown): string[] {
  if (!Array.isArray(v) || v.length > 100) throw new TypeError('pinned must be an array');
  return v.map((x) => assertString(x, 'pinned line', 200));
}
function validateUnanswered(v: unknown): { text: string; hint: string }[] {
  if (!Array.isArray(v) || v.length > 200) throw new TypeError('items must be an array');
  return v.map((x) => {
    const o = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>;
    return { text: assertString(o.text, 'text', 500), hint: typeof o.hint === 'string' ? o.hint.slice(0, 300) : '' };
  });
}

const api: FataakApi = {
  platform: process.platform,
  version: process.env.npm_package_version ?? '',
  app: {
    info: () => ipcRenderer.invoke('app:info'),
    checkUpdate: () => ipcRenderer.invoke('app:checkUpdate'),
    installUpdate: (url, version) => ipcRenderer.invoke('app:installUpdate', assertString(url, 'url', 500), assertString(version, 'version', 20)),
    onUpdateProgress: (cb) => {
      const handler = (_e: unknown, p: unknown) => {
        const o = (p && typeof p === 'object' ? p : {}) as Record<string, unknown>;
        cb({ received: Number(o.received) || 0, total: Number(o.total) || 0, phase: (o.phase as 'downloading') ?? 'downloading' });
      };
      ipcRenderer.on('app:updateProgress', handler);
      return () => ipcRenderer.removeListener('app:updateProgress', handler);
    },
  },
  pinned: {
    load: () => ipcRenderer.invoke('pinned:load'),
    save: (lines) => ipcRenderer.invoke('pinned:save', validatePinned(lines)),
  },
  teach: {
    load: () => ipcRenderer.invoke('teach:load'),
    save: (rules) => ipcRenderer.invoke('teach:save', sanitizeRules(rules)),
  },
  unanswered: {
    load: () => ipcRenderer.invoke('unanswered:load'),
    add: (items) => ipcRenderer.invoke('unanswered:add', validateUnanswered(items)),
    clear: () => ipcRenderer.invoke('unanswered:clear'),
    exportCsv: () => ipcRenderer.invoke('unanswered:export'),
    csv: () => ipcRenderer.invoke('unanswered:csv'),
  },
  history: {
    load: () => ipcRenderer.invoke('history:load'),
    save: (lines) => ipcRenderer.invoke('history:save', validateLines(lines)),
  },
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    set: (patch) => ipcRenderer.invoke('settings:set', validateSettingsPatch(patch)),
  },
  rates: {
    get: (base) => {
      const b = assertString(base, 'base', 3).toUpperCase();
      if (!/^[A-Z]{3}$/.test(b)) return Promise.resolve(null);
      return ipcRenderer.invoke('rates:get', b);
    },
    getHistorical: (base, date) => {
      const b = assertString(base, 'base', 3).toUpperCase();
      const d = assertString(date, 'date', 10);
      if (!/^[A-Z]{3}$/.test(b) || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return Promise.resolve(null);
      return ipcRenderer.invoke('rates:getHistorical', b, d);
    },
  },
  window: {
    hide: () => ipcRenderer.send('window:hide'),
    minimize: () => ipcRenderer.send('window:minimize'),
    close: () => ipcRenderer.send('window:close'),
    toggleMaximize: () => ipcRenderer.send('window:toggleMaximize'),
    quit: () => ipcRenderer.send('app:quit'),
  },
  clipboard: {
    write: (text) => ipcRenderer.send('clipboard:write', assertString(text, 'text', 100000)),
  },
  launcher: {
    hide: () => ipcRenderer.send('launcher:hide'),
    openInMain: (text) => ipcRenderer.send('launcher:openInMain', assertString(text, 'text', 2000)),
    record: (text) => ipcRenderer.send('launcher:record', assertString(text, 'text', 2000)),
  },
  onShow: (cb) => {
    const handler = () => cb();
    ipcRenderer.on('app:show', handler);
    return () => ipcRenderer.removeListener('app:show', handler);
  },
  onInsert: (cb) => {
    const handler = (_e: unknown, text: unknown) => typeof text === 'string' && cb(text.slice(0, 2000));
    ipcRenderer.on('app:insert', handler);
    return () => ipcRenderer.removeListener('app:insert', handler);
  },
};

contextBridge.exposeInMainWorld('fataak', api);
