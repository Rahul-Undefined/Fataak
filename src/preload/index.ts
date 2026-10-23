import { contextBridge, ipcRenderer } from 'electron';
import type { FataakApi, Settings } from '../shared/api';
import type { HistoryLine } from '../engine/history';

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
  for (const k of ['tray', 'closeToTray', 'alwaysOnTop'] as const) {
    if (k in o) {
      if (typeof o[k] !== 'boolean') throw new TypeError(`${k} must be boolean`);
      out[k] = o[k] as boolean;
    }
  }
  return out;
}

const api: FataakApi = {
  platform: process.platform,
  version: process.env.npm_package_version ?? '',
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
  onShow: (cb) => {
    const handler = () => cb();
    ipcRenderer.on('app:show', handler);
    return () => ipcRenderer.removeListener('app:show', handler);
  },
};

contextBridge.exposeInMainWorld('fataak', api);
