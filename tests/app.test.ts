import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JsonStore } from '../src/main/store';
import { DEFAULT_SETTINGS } from '../src/shared/api';
import { sanitizeLines } from '@engine/history';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('application behaviour: local storage', () => {
  it('writes atomically and reads back validated data', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'fataak-'));
    dirs.push(dir);
    const store = new JsonStore(dir, 'history.json', sanitizeLines, () => []);
    expect(await store.read()).toEqual([]);
    await store.write([{ id: 'a', text: '1 + 1', createdAt: 1 }]);
    expect(existsSync(join(dir, 'history.json.tmp'))).toBe(false);
    expect(JSON.parse(readFileSync(join(dir, 'history.json'), 'utf8'))).toEqual([{ id: 'a', text: '1 + 1', createdAt: 1 }]);
    expect(await store.read()).toEqual([{ id: 'a', text: '1 + 1', createdAt: 1 }]);
  });

  it('falls back to defaults on corrupt files', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'fataak-'));
    dirs.push(dir);
    const store = new JsonStore(dir, 'settings.json', (raw) => ({ ...DEFAULT_SETTINGS, ...(raw as object) }), () => ({ ...DEFAULT_SETTINGS }));
    await store.write({ ...DEFAULT_SETTINGS, hotkey: 'Control+Shift+Space' });
    expect((await store.read()).hotkey).toBe('Control+Shift+Space');
    const { writeFileSync } = await import('node:fs');
    writeFileSync(join(dir, 'settings.json'), '{not json');
    expect(await store.read()).toEqual(DEFAULT_SETTINGS);
  });

  it('serialises concurrent writes (last write wins, file never torn)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'fataak-'));
    dirs.push(dir);
    const store = new JsonStore<number[]>(dir, 'n.json', (r) => (Array.isArray(r) ? (r as number[]) : []), () => []);
    await Promise.all([store.write([1]), store.write([1, 2]), store.write([1, 2, 3])]);
    expect(await store.read()).toEqual([1, 2, 3]);
  });
});

describe('application behaviour: defaults', () => {
  it('has a global hotkey, tray and close-to-tray by default', () => {
    expect(DEFAULT_SETTINGS.hotkey).toBe('Alt+Space');
    expect(DEFAULT_SETTINGS.tray).toBe(true);
    expect(DEFAULT_SETTINGS.closeToTray).toBe(true);
  });
});
