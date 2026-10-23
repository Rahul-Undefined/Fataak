import { app, BrowserWindow, globalShortcut, ipcMain, Menu, Tray, clipboard, nativeImage, session, shell, screen } from 'electron';
import { join } from 'node:path';
import { DEFAULT_SETTINGS, type Settings, type SettingsResult } from '../shared/api';
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

let win: BrowserWindow | null = null;
let tray: Tray | null = null;
let quitting = false;
let settings: Settings = { ...DEFAULT_SETTINGS };

const userData = app.getPath('userData');
const historyStore = new JsonStore<HistoryLine[]>(userData, 'history.json', sanitizeLines, () => []);
const settingsStore = new JsonStore<Settings>(userData, 'settings.json', validateSettings, () => ({ ...DEFAULT_SETTINGS }));
const rates = new RateService(userData);

function validateSettings(raw: unknown): Settings {
  const out: Settings = { ...DEFAULT_SETTINGS };
  if (!raw || typeof raw !== 'object') return out;
  const o = raw as Record<string, unknown>;
  if (typeof o.hotkey === 'string' && o.hotkey.length <= 64) out.hotkey = o.hotkey;
  for (const k of ['tray', 'closeToTray', 'alwaysOnTop'] as const) if (typeof o[k] === 'boolean') out[k] = o[k] as boolean;
  return out;
}

// ---------------------------------------------------------------- window
function createWindow(): BrowserWindow {
  const w = new BrowserWindow({
    width: 460,
    height: 470,
    minWidth: 320,
    minHeight: 220,
    frame: false,
    show: false,
    backgroundColor: '#1c1c1c',
    title: 'FATAAK',
    icon: process.platform === 'win32' ? ICON_ICO : ICON_PNG,
    alwaysOnTop: settings.alwaysOnTop,
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
    if (!quitting && settings.tray && settings.closeToTray) {
      e.preventDefault();
      w.hide();
    }
  });
  w.on('closed', () => {
    win = null;
  });
  w.once('ready-to-show', () => {
    w.show();
    w.focus();
  });

  if (isDev) void w.loadURL(process.env['ELECTRON_RENDERER_URL']!);
  else void w.loadFile(join(__dirname, '../renderer/index.html'));
  return w;
}

function showWindow(): void {
  if (!win || win.isDestroyed()) win = createWindow();
  if (win.isMinimized()) win.restore();
  if (!win.isVisible()) {
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

function updateTray(): void {
  if (settings.tray && !tray) {
    tray = new Tray(trayIcon());
    tray.setToolTip('FATAAK — Think it. Type it. Fataak.');
    tray.setContextMenu(
      Menu.buildFromTemplate([
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
      ]),
    );
    tray.on('click', () => toggleWindow());
  } else if (!settings.tray && tray) {
    tray.destroy();
    tray = null;
  }
}

function applySettings(): SettingsResult {
  const hotkeyError = registerHotkeyWithFallback();
  updateTray();
  if (win && !win.isDestroyed()) win.setAlwaysOnTop(settings.alwaysOnTop);
  return { settings, hotkeyError };
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
ipcMain.handle('rates:get', async (e, base: unknown) => {
  if (!fromWindow(e) || typeof base !== 'string' || !/^[A-Z]{3}$/.test(base)) return null;
  return rates.get(base);
});
ipcMain.on('window:hide', (e) => fromWindow(e) && win?.hide());
ipcMain.on('window:minimize', (e) => fromWindow(e) && win?.minimize());
ipcMain.on('window:toggleMaximize', (e) => {
  if (!fromWindow(e) || !win) return;
  if (win.isMaximized()) win.unmaximize();
  else win.maximize();
});
ipcMain.on('window:close', (e) => fromWindow(e) && win?.close());
ipcMain.on('app:quit', (e) => {
  if (!fromWindow(e)) return;
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
