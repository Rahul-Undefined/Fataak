import { app, BrowserWindow, globalShortcut, ipcMain, Menu, Tray, clipboard, nativeImage, net, session, shell, screen } from 'electron';
import { join } from 'node:path';
import { statSync } from 'node:fs';
import { DEFAULT_SETTINGS, type AppInfo, type Settings, type SettingsResult, type UpdateCheck } from '../shared/api';
import { pruneExpired, sanitizeLines, type HistoryLine } from '../engine/history';
import { JsonStore } from './store';
import { RateService } from './rates';

const isDev = !app.isPackaged && !!process.env['ELECTRON_RENDERER_URL'];
const APP_ID = 'com.fataak.calculator';

const SHORTCUTS_MODE = process.argv.includes('--install-shortcuts');

// ---------------------------------------------------------------- single instance
if (SHORTCUTS_MODE) {
  // handled in installShortcutsAndExit() below; no window, no lock
} else if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => showWindow());
}

interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}
type StoredSettings = Settings & { bounds?: Bounds };

let win: BrowserWindow | null = null;
let tray: Tray | null = null;
let quitting = false;
let settings: StoredSettings = { ...DEFAULT_SETTINGS };

const userData = app.getPath('userData');
const historyStore = new JsonStore<HistoryLine[]>(userData, 'history.json', sanitizeLines, () => []);
const settingsStore = new JsonStore<StoredSettings>(userData, 'settings.json', validateSettings, () => ({ ...DEFAULT_SETTINGS }));
const rates = new RateService(userData);

function validateSettings(raw: unknown): StoredSettings {
  const out: StoredSettings = { ...DEFAULT_SETTINGS };
  if (!raw || typeof raw !== 'object') return out;
  const o = raw as Record<string, unknown>;
  if (typeof o.hotkey === 'string' && o.hotkey.length <= 64) out.hotkey = o.hotkey;
  if (typeof o.updateUrl === 'string' && o.updateUrl.length <= 300 && (o.updateUrl === '' || /^https:\/\//.test(o.updateUrl))) out.updateUrl = o.updateUrl;
  if (o.theme === 'dark' || o.theme === 'light') out.theme = o.theme;
  for (const k of ['tray', 'closeToTray', 'alwaysOnTop', 'widgetMode', 'tutorialSeen'] as const) if (typeof o[k] === 'boolean') out[k] = o[k] as boolean;
  const b = o.bounds as Record<string, unknown> | undefined;
  if (b && ['x', 'y', 'width', 'height'].every((k) => Number.isFinite(b[k]))) {
    out.bounds = { x: b.x as number, y: b.y as number, width: Math.max(320, b.width as number), height: Math.max(220, b.height as number) };
  }
  return out;
}

/** a saved position is only reused when it is still on a connected display */
function usableBounds(): Bounds | undefined {
  const b = settings.bounds;
  if (!b) return undefined;
  const onScreen = screen.getAllDisplays().some((d) => b.x >= d.workArea.x - 20 && b.y >= d.workArea.y - 20 && b.x < d.workArea.x + d.workArea.width && b.y < d.workArea.y + d.workArea.height);
  return onScreen ? b : undefined;
}

// ---------------------------------------------------------------- window
function createWindow(): BrowserWindow {
  const saved = usableBounds();
  const w = new BrowserWindow({
    width: saved?.width ?? 480,
    height: saved?.height ?? 520,
    x: saved?.x,
    y: saved?.y,
    minWidth: 320,
    minHeight: 220,
    frame: false,
    show: false,
    backgroundColor: settings.theme === 'light' ? '#f6f7f9' : '#0f1419',
    title: 'FATAAK',
    icon: process.platform === 'win32' ? ICON_ICO : ICON_PNG,
    alwaysOnTop: settings.alwaysOnTop && !settings.widgetMode,
    skipTaskbar: settings.widgetMode,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      spellcheck: false,
      devTools: isDev,
    },
  });
  w.setMenuBarVisibility(false);

  // never navigate away or open windows
  w.webContents.on('will-navigate', (e) => e.preventDefault());
  w.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });

  w.on('close', (e) => {
    // widget mode: the window stays until the app is ended (Task Manager) or widget mode is switched off
    if (!quitting && settings.widgetMode) {
      e.preventDefault();
      return;
    }
    if (!quitting && settings.tray && settings.closeToTray) {
      e.preventDefault();
      w.hide();
    }
  });
  w.on('minimize', () => {
    if (settings.widgetMode) setTimeout(() => !w.isDestroyed() && w.restore(), 0);
  });
  w.on('closed', () => {
    win = null;
  });
  let boundsTimer: NodeJS.Timeout | undefined;
  const rememberBounds = () => {
    clearTimeout(boundsTimer);
    boundsTimer = setTimeout(() => {
      if (w.isDestroyed() || w.isMinimized() || w.isMaximized()) return;
      settings = { ...settings, bounds: w.getBounds() };
      void settingsStore.write(settings);
    }, 400);
  };
  w.on('moved', rememberBounds);
  w.on('resized', rememberBounds);
  w.once('ready-to-show', () => {
    w.show();
    w.focus();
    applyWidgetMode(w);
  });

  if (isDev) void w.loadURL(process.env['ELECTRON_RENDERER_URL']!);
  else void w.loadFile(join(__dirname, '../renderer/index.html'));
  return w;
}

/** Desktop-widget behaviour: pinned in place, no taskbar entry, cannot be moved, minimised or closed from the UI. */
function applyWidgetMode(w: BrowserWindow): void {
  const on = settings.widgetMode;
  w.setSkipTaskbar(on);
  w.setMovable(!on);
  w.setMinimizable(!on);
  w.setMaximizable(!on);
  w.setResizable(!on);
  w.setClosable(!on);
  w.setAlwaysOnTop(on ? false : settings.alwaysOnTop);
  w.setVisibleOnAllWorkspaces(on, { visibleOnFullScreen: false });
  if (on) {
    if (w.isMaximized()) w.unmaximize();
    if (w.isMinimized()) w.restore();
    if (!w.isVisible()) w.show();
  }
}

function showWindow(): void {
  if (!win || win.isDestroyed()) win = createWindow();
  if (win.isMinimized()) win.restore();
  if (!win.isVisible() && !usableBounds()) {
    // open on the display where the cursor is, keeping the last size
    const { x, y } = screen.getCursorScreenPoint();
    const display = screen.getDisplayNearestPoint({ x, y });
    const [w, h] = win.getSize();
    const b = display.workArea;
    win.setPosition(Math.round(b.x + (b.width - w) / 2), Math.round(b.y + (b.height - h) / 2));
  }
  win.show();
  win.focus();
  win.webContents.send('app:show');
}

function toggleWindow(): void {
  if (settings.widgetMode) {
    showWindow();
    return;
  }
  if (win && !win.isDestroyed() && win.isVisible() && win.isFocused()) win.hide();
  else showWindow();
}

// ---------------------------------------------------------------- hotkey & tray
const FALLBACK_HOTKEYS = ['Alt+Space', 'Control+Alt+Space', 'Control+Alt+F'];

function registerHotkey(accel: string): string | undefined {
  globalShortcut.unregisterAll();
  if (!accel) return undefined;
  try {
    const ok = globalShortcut.register(accel, toggleWindow);
    if (!ok) return `could not register ${accel} (in use by another app?)`;
    return undefined;
  } catch (e) {
    return `invalid hotkey: ${(e as Error).message}`;
  }
}

/** Register the configured hotkey, falling back to the first free launcher-style key. */
function registerHotkeyWithFallback(): string | undefined {
  const err = registerHotkey(settings.hotkey);
  if (!err) return undefined;
  for (const alt of FALLBACK_HOTKEYS) {
    if (alt === settings.hotkey) continue;
    if (!registerHotkey(alt)) {
      settings = { ...settings, hotkey: alt };
      void settingsStore.write(settings);
      return `${err}; using ${alt}`;
    }
  }
  return err;
}

const ICON_ICO = join(__dirname, '../../resources/icon.ico');
const ICON_PNG = join(__dirname, '../../resources/icon.png');

/**
 * Windows takes a pinned taskbar icon from the Start Menu shortcut that carries the app's
 * AppUserModelID. Writing that shortcut ourselves (no installer needed) makes pinning show
 * the FATAAK logo instead of the stock Electron icon.
 */
function writeShortcut(lnk: string): boolean {
  try {
    // 'create' overwrites an existing shortcut too; 'replace' fails when none exists yet
    return shell.writeShortcutLink(lnk, 'create', {
      target: process.execPath,
      cwd: join(process.execPath, '..'),
      icon: ICON_ICO,
      iconIndex: 0,
      appUserModelId: APP_ID,
      description: 'FATAAK — Think it. Type it. Fataak.',
    });
  } catch (e) {
    console.warn('could not write shortcut', lnk, e);
    return false;
  }
}

function startMenuShortcutPath(): string {
  return join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'FATAAK.lnk');
}

function ensureStartMenuShortcut(): void {
  if (process.platform !== 'win32' || !app.isPackaged) return;
  writeShortcut(startMenuShortcutPath());
}

/** `FATAAK.exe --install-shortcuts`: used by Install-FATAAK.cmd (no PowerShell/COM quoting pitfalls). */
function installShortcutsAndExit(): void {
  app.whenReady().then(() => {
    const ok1 = writeShortcut(startMenuShortcutPath());
    const ok2 = writeShortcut(join(app.getPath('desktop'), 'FATAAK.lnk'));
    console.log(`shortcuts: start menu ${ok1 ? 'ok' : 'failed'}, desktop ${ok2 ? 'ok' : 'failed'}`);
    app.exit(ok1 && ok2 ? 0 : 1);
  });
}

function trayIcon(): Electron.NativeImage {
  const img = nativeImage.createFromPath(join(__dirname, '../../resources/tray.png'));
  return img.isEmpty() ? nativeImage.createEmpty() : img;
}

function trayMenu(): Menu {
  if (settings.widgetMode) {
    return Menu.buildFromTemplate([
      { label: 'Show FATAAK', click: () => showWindow() },
      { type: 'separator' },
      { label: 'Widget mode is on: turn it off in the app to move or close', enabled: false },
      {
        label: 'Turn widget mode off',
        click: () => {
          settings = { ...settings, widgetMode: false };
          void settingsStore.write(settings);
          applySettings();
          win?.webContents.send('app:show');
        },
      },
    ]);
  }
  return Menu.buildFromTemplate([
    { label: 'Show FATAAK', click: () => showWindow() },
    { label: 'Hide', click: () => win?.hide() },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        quitting = true;
        app.quit();
      },
    },
  ]);
}

function updateTray(): void {
  if (settings.tray && !tray) {
    tray = new Tray(trayIcon());
    tray.setToolTip('FATAAK — Think it. Type it. Fataak.');
    tray.on('click', () => toggleWindow());
  } else if (!settings.tray && tray) {
    tray.destroy();
    tray = null;
  }
  tray?.setContextMenu(trayMenu());
}

function applySettings(): SettingsResult {
  const hotkeyError = registerHotkeyWithFallback();
  updateTray();
  if (win && !win.isDestroyed()) {
    applyWidgetMode(win);
    win.setBackgroundColor(settings.theme === 'light' ? '#f6f7f9' : '#0f1419');
  }
  return { settings, hotkeyError };
}

// ---------------------------------------------------------------- app info & updates
function appInfo(): AppInfo {
  let buildDate = '';
  try {
    buildDate = statSync(__filename).mtime.toISOString().slice(0, 10);
  } catch {
    buildDate = '';
  }
  return { version: app.getVersion(), buildDate, platform: process.platform, packaged: app.isPackaged };
}

function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((x) => parseInt(x, 10) || 0);
  const pb = b.split('.').map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

/** reads { "version": "x.y.z", "url": "https://…" } from the configured HTTPS URL; never installs anything */
async function checkUpdate(): Promise<UpdateCheck> {
  const current = app.getVersion();
  const url = settings.updateUrl;
  if (!url) return { current, status: 'no update source set (Settings → update URL)' };
  if (!/^https:\/\//.test(url)) return { current, status: 'the update URL must start with https://' };
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    const res = await net.fetch(url, { signal: ctrl.signal, headers: { accept: 'application/json' } });
    clearTimeout(t);
    if (!res.ok) return { current, status: `update check failed (HTTP ${res.status})` };
    const j = (await res.json()) as { version?: unknown; url?: unknown };
    const latest = typeof j.version === 'string' && /^\d+(\.\d+){0,3}$/.test(j.version) ? j.version : undefined;
    if (!latest) return { current, status: 'update file has no valid "version"' };
    const link = typeof j.url === 'string' && /^https:\/\//.test(j.url) ? j.url : undefined;
    const cmp = compareVersions(latest, current);
    return { current, latest, url: link, status: cmp > 0 ? `update available: ${latest}` : cmp < 0 ? `you have a newer build than ${latest}` : 'up to date' };
  } catch (e) {
    return { current, status: `update check failed: ${(e as Error).message}` };
  }
}

// ---------------------------------------------------------------- IPC (all inputs validated)
function fromWindow(e: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent): boolean {
  return !!win && e.sender === win.webContents;
}

ipcMain.handle('history:load', async (e) => {
  if (!fromWindow(e)) return [];
  const lines = await historyStore.read();
  const pruned = pruneExpired(lines, Date.now());
  if (pruned.length !== lines.length) void historyStore.write(pruned);
  return pruned;
});
ipcMain.handle('history:save', async (e, raw: unknown) => {
  if (!fromWindow(e)) return;
  await historyStore.write(pruneExpired(sanitizeLines(raw), Date.now()));
});
ipcMain.handle('settings:get', (e) => (fromWindow(e) ? { settings } : { settings: DEFAULT_SETTINGS }));
ipcMain.handle('settings:set', async (e, patch: unknown) => {
  if (!fromWindow(e)) return { settings };
  const next = validateSettings({ ...settings, ...(patch && typeof patch === 'object' ? (patch as object) : {}) });
  const prevHotkey = settings.hotkey;
  settings = next;
  const result = applySettings();
  if (result.hotkeyError) {
    // keep the old working hotkey
    settings = { ...settings, hotkey: prevHotkey };
    registerHotkey(prevHotkey);
    result.settings = settings;
  }
  await settingsStore.write(settings);
  return result;
});
ipcMain.handle('app:info', (e) => (fromWindow(e) ? appInfo() : null));
ipcMain.handle('app:checkUpdate', (e) => (fromWindow(e) ? checkUpdate() : { current: '', status: 'denied' }));
ipcMain.handle('rates:get', async (e, base: unknown) => {
  if (!fromWindow(e) || typeof base !== 'string' || !/^[A-Z]{3}$/.test(base)) return null;
  return rates.get(base);
});
ipcMain.handle('rates:getHistorical', async (e, base: unknown, date: unknown) => {
  if (!fromWindow(e) || typeof base !== 'string' || !/^[A-Z]{3}$/.test(base)) return null;
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  return rates.getHistorical(base, date);
});
ipcMain.on('window:hide', (e) => fromWindow(e) && !settings.widgetMode && win?.hide());
ipcMain.on('window:minimize', (e) => fromWindow(e) && !settings.widgetMode && win?.minimize());
ipcMain.on('window:toggleMaximize', (e) => {
  if (!fromWindow(e) || !win || settings.widgetMode) return;
  if (win.isMaximized()) win.unmaximize();
  else win.maximize();
});
ipcMain.on('window:close', (e) => fromWindow(e) && !settings.widgetMode && win?.close());
ipcMain.on('app:quit', (e) => {
  if (!fromWindow(e) || settings.widgetMode) return;
  quitting = true;
  app.quit();
});
ipcMain.on('clipboard:write', (e, text: unknown) => {
  if (!fromWindow(e) || typeof text !== 'string' || text.length > 100000) return;
  clipboard.writeText(text);
});

// ---------------------------------------------------------------- lifecycle
if (SHORTCUTS_MODE) installShortcutsAndExit();

app.whenReady().then(async () => {
  if (SHORTCUTS_MODE) return;
  app.setAppUserModelId(APP_ID);
  settings = await settingsStore.read();
  ensureStartMenuShortcut();

  // Restrictive CSP for the packaged renderer (dev needs Vite's inline/HMR scripts).
  if (!isDev) {
    session.defaultSession.webRequest.onHeadersReceived((details, cb) => {
      cb({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': ["default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"],
        },
      });
    });
  }
  // the renderer never needs any permission (camera, notifications, …)
  session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));

  win = createWindow();
  const r = applySettings();
  if (r.hotkeyError) console.warn(r.hotkeyError);

  // sweep expired history once a minute even while hidden
  setInterval(async () => {
    const lines = await historyStore.read();
    const pruned = pruneExpired(lines, Date.now());
    if (pruned.length !== lines.length) void historyStore.write(pruned);
  }, 60_000);
});

app.on('before-quit', () => {
  quitting = true;
});
app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', () => {
  if (!settings.tray) app.quit();
});
app.on('activate', () => showWindow());
