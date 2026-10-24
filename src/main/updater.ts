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
    // download (one retry: GitHub's asset host occasionally resets the first connection)
    let res: Response | null = null;
    for (let attempt = 0; attempt < 2 && !res; attempt++) {
      try {
        res = await net.fetch(url, { headers: { 'user-agent': `FATAAK/${app.getVersion()}` } });
      } catch (e) {
        if (attempt === 1) throw e;
      }
    }
    if (!res || !res.ok || !res.body) return { ok: false, status: `download failed (HTTP ${res?.status ?? 'no response'})` };
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
    // the apply script (PowerShell, started hidden through wscript so no console window ever shows): wait for
    // THIS process id to end (child processes share the FATAAK.exe name, so a name check would wait forever),
    // copy the new files over the install folder, clear the "from the internet" mark, start FATAAK again
    const ps1 = join(dir, 'apply-update.ps1');
    const vbs = join(dir, 'apply-update.vbs');
    const log = join(dir, 'apply-update.log');
    const q = (x: string) => `'${x.replace(/'/g, "''")}'`;
    const script = [
      `$src = ${q(extract)}`,
      `$dst = ${q(installDir)}`,
      `$log = ${q(log)}`,
      `$oldPid = ${process.pid}`,
      `"waiting for FATAAK (pid $oldPid) to exit" | Out-File -FilePath $log -Encoding utf8`,
      'for ($i = 0; $i -lt 40; $i++) {',
      '  if (-not (Get-Process -Id $oldPid -ErrorAction SilentlyContinue)) { break }',
      '  Start-Sleep -Milliseconds 500',
      '}',
      'if (Get-Process -Id $oldPid -ErrorAction SilentlyContinue) {',
      '  "still running after 20 s, ending it" | Out-File -FilePath $log -Append -Encoding utf8',
      '  Stop-Process -Id $oldPid -Force -ErrorAction SilentlyContinue',
      '  Start-Sleep -Seconds 2',
      '}',
      // any helper process of the old instance (gpu, renderer) ends with the main process; give them a moment
      'Start-Sleep -Milliseconds 800',
      '$r = Start-Process -FilePath robocopy.exe -ArgumentList @("`"$src`"", "`"$dst`"", "/E", "/R:5", "/W:1", "/NFL", "/NDL", "/NJH", "/NJS", "/NC", "/NS", "/NP") -Wait -PassThru -WindowStyle Hidden',
      '"robocopy exit $($r.ExitCode)" | Out-File -FilePath $log -Append -Encoding utf8',
      'if ($r.ExitCode -ge 8) {',
      '  "update could not be applied" | Out-File -FilePath $log -Append -Encoding utf8',
      '  Start-Process -FilePath (Join-Path $dst "FATAAK.exe")',
      '  exit 1',
      '}',
      'Get-ChildItem -LiteralPath $dst -Recurse -File -ErrorAction SilentlyContinue | Unblock-File -ErrorAction SilentlyContinue',
      'Start-Process -FilePath (Join-Path $dst "FATAAK.exe")',
      'Remove-Item -LiteralPath $src -Recurse -Force -ErrorAction SilentlyContinue',
      `Remove-Item -LiteralPath ${q(zip)} -Force -ErrorAction SilentlyContinue`,
      '"done" | Out-File -FilePath $log -Append -Encoding utf8',
      '',
    ].join('\r\n');
    await writeFile(ps1, '\ufeff' + script, 'utf8');
    const launcher = `CreateObject("WScript.Shell").Run "powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File ""${ps1}""", 0, False\r\n`;
    await writeFile(vbs, launcher, 'utf8');
    progress(size, size, 'restarting');
    const child = spawn('wscript.exe', ['//B', '//Nologo', vbs], { detached: true, stdio: 'ignore', windowsHide: true, cwd: dir });
    child.unref();
    // leave the event loop: quit normally, and if anything holds the process open, exit outright
    setTimeout(() => {
      quit();
      setTimeout(() => app.exit(0), 1500);
    }, 400);
    return { ok: true, status: `installing ${version}; FATAAK will restart` };
  } catch (e) {
    return { ok: false, status: `update failed: ${(e as Error).message}` };
  }
}
