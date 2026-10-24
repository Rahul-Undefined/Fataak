/**
 * Self-update from GitHub Releases. "Check for updates" asks the GitHub API for the latest release of the
 * configured repository; "Install" downloads the FATAAK-<version>-x64.zip asset, extracts it with
 * PowerShell (no admin rights), then hands over to a small cmd script that waits for FATAAK to exit,
 * copies the new files over the install folder with robocopy, and starts FATAAK again.
 *
 * Nothing is executed from the download except FATAAK.exe itself, which is the unmodified Electron binary
 * the user already runs. The repository must be public (or its releases must be), because the app carries
 * no token.
 */
import { app, net, type BrowserWindow } from 'electron';
import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdir, rm, stat, writeFile, access } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { UpdateCheck, UpdateInstall } from '../shared/api';

export const DEFAULT_REPO = 'Rahul-Undefined/Fataak';
const REPO_RE = /^[\w.-]+\/[\w.-]+$/;

export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((x) => parseInt(x, 10) || 0);
  const pb = b.split('.').map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

interface Release {
  tag_name?: unknown;
  assets?: { name?: unknown; browser_download_url?: unknown; size?: unknown }[];
}

/** asks GitHub for the latest release; never installs anything */
export async function checkGithub(repo: string): Promise<UpdateCheck> {
  const current = app.getVersion();
  if (!REPO_RE.test(repo)) return { current, status: 'update source must look like owner/repo', canInstall: false };
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 10000);
    const res = await net.fetch(`https://api.github.com/repos/${repo}/releases/latest`, { signal: ctrl.signal, headers: { accept: 'application/vnd.github+json', 'user-agent': `FATAAK/${current}` } });
    clearTimeout(t);
    if (res.status === 404) return { current, status: `no release found at github.com/${repo} (is the repository public?)`, canInstall: false };
    if (res.status === 403) return { current, status: 'GitHub rate limit reached, try again in an hour', canInstall: false };
    if (!res.ok) return { current, status: `update check failed (HTTP ${res.status})`, canInstall: false };
    const j = (await res.json()) as Release;
    const tag = typeof j.tag_name === 'string' ? j.tag_name.replace(/^v/i, '') : '';
    if (!/^\d+(\.\d+){0,3}$/.test(tag)) return { current, status: 'the latest release has no version tag', canInstall: false };
    const asset = (j.assets ?? []).find((a) => typeof a.name === 'string' && /^FATAAK-.*-x64\.zip$/i.test(a.name) && typeof a.browser_download_url === 'string');
    const cmp = compareVersions(tag, current);
    if (cmp <= 0) return { current, latest: tag, status: cmp === 0 ? 'up to date' : `you have a newer build than ${tag}`, canInstall: false };
    if (!asset) return { current, latest: tag, status: `${tag} is published but has no Windows zip yet`, canInstall: false };
    return { current, latest: tag, url: asset.browser_download_url as string, size: typeof asset.size === 'number' ? asset.size : undefined, status: `update available: ${tag}`, canInstall: app.isPackaged && process.platform === 'win32' };
  } catch (e) {
    return { current, status: `update check failed: ${(e as Error).message}`, canInstall: false };
  }
}

function run(cmd: string, args: string[]): Promise<number> {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { windowsHide: true, stdio: 'ignore' });
    p.on('error', () => resolve(-1));
    p.on('exit', (code) => resolve(code ?? -1));
  });
}

/**
 * downloads and stages the release, then starts the apply script and quits. Progress is sent to the window as
 * 'app:updateProgress' { received, total, phase }.
 */
export async function installUpdate(url: string, version: string, win: BrowserWindow | null, quit: () => void): Promise<UpdateInstall> {
  if (!app.isPackaged) return { ok: false, status: 'updates install only in the installed app' };
  if (!/^https:\/\/(github\.com|objects\.githubusercontent\.com)\//.test(url)) return { ok: false, status: 'refusing to download from outside GitHub' };
  if (!/^\d+(\.\d+){0,3}$/.test(version)) return { ok: false, status: 'bad version' };
  const progress = (received: number, total: number, phase: string) => {
    if (win && !win.isDestroyed()) win.webContents.send('app:updateProgress', { received, total, phase });
  };
  const dir = join(app.getPath('userData'), 'updates');
  const zip = join(dir, `FATAAK-${version}-x64.zip`);
  const extract = join(dir, `FATAAK-${version}`);
  const installDir = dirname(process.execPath);
  try {
    await rm(dir, { recursive: true, force: true });
    await mkdir(dir, { recursive: true });
    // download
    const res = await net.fetch(url, { headers: { 'user-agent': `FATAAK/${app.getVersion()}` } });
    if (!res.ok || !res.body) return { ok: false, status: `download failed (HTTP ${res.status})` };
    const total = parseInt(res.headers.get('content-length') ?? '0', 10) || 0;
    let received = 0;
    const counter = new Readable({ read() {} });
    const reader = res.body.getReader();
    const pump = async () => {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        received += value.byteLength;
        progress(received, total, 'downloading');
        counter.push(Buffer.from(value));
      }
      counter.push(null);
    };
    await Promise.all([pump(), pipeline(counter, createWriteStream(zip))]);
    const size = (await stat(zip)).size;
    if (size < 1_000_000) return { ok: false, status: 'the download is too small to be FATAAK' };
    // extract (Expand-Archive ships with Windows PowerShell; no admin rights)
    progress(size, size, 'extracting');
    const code = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', `Expand-Archive -LiteralPath '${zip.replace(/'/g, "''")}' -DestinationPath '${extract.replace(/'/g, "''")}' -Force`]);
    if (code !== 0) return { ok: false, status: 'could not extract the update' };
    try {
      await access(join(extract, 'FATAAK.exe'));
      await access(join(extract, 'resources', 'app', 'package.json'));
    } catch {
      return { ok: false, status: 'the update does not look like a FATAAK build' };
    }
    // the apply script: wait for this process to end, copy, restart
    const script = join(dir, 'apply-update.cmd');
    const log = join(dir, 'apply-update.log');
    const lines = [
      '@echo off',
      'setlocal',
      `set "SRC=${extract}"`,
      `set "DST=${installDir}"`,
      `set "LOG=${log}"`,
      'set /a tries=0',
      ':wait',
      'tasklist /fi "imagename eq FATAAK.exe" 2>nul | find /i "FATAAK.exe" >nul',
      'if not errorlevel 1 (',
      '  set /a tries+=1',
      '  if %tries% geq 60 goto failed',
      '  timeout /t 1 /nobreak >nul',
      '  goto wait',
      ')',
      'robocopy "%SRC%" "%DST%" /E /R:5 /W:1 /NFL /NDL /NJH /NJS /NC /NS /NP > "%LOG%" 2>&1',
      'if errorlevel 8 goto failed',
      // files extracted from a downloaded zip may carry the "from the internet" mark; clear it (per-user, no admin)
      'powershell -NoProfile -NonInteractive -Command "Get-ChildItem -LiteralPath \'%DST%\' -Recurse -File | Unblock-File -ErrorAction SilentlyContinue" >nul 2>&1',
      'start "" "%DST%\\FATAAK.exe"',
      'rmdir /s /q "%SRC%" >nul 2>&1',
      `del /q "${zip}" >nul 2>&1`,
      'exit /b 0',
      ':failed',
      'echo update could not be applied >> "%LOG%"',
      'start "" "%DST%\\FATAAK.exe"',
      'exit /b 1',
      '',
    ];
    await writeFile(script, lines.join('\r\n'), 'utf8');
    progress(size, size, 'restarting');
    const child = spawn('cmd.exe', ['/c', script], { detached: true, stdio: 'ignore', windowsHide: true, cwd: dir });
    child.unref();
    setTimeout(quit, 400);
    return { ok: true, status: `installing ${version}; FATAAK will restart` };
  } catch (e) {
    return { ok: false, status: `update failed: ${(e as Error).message}` };
  }
}
