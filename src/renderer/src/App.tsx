import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { evaluateDocument, pruneExpired, syncLines, newId, type HistoryLine, type LineResult, type HighlightSpan } from '../../engine/index';
import type { AppInfo, Settings, UpdateCheck } from '../../shared/api';
import { DEFAULT_SETTINGS } from '../../shared/api';
import { api, isElectron } from './bridge';
import { RendererRates } from './rates';
import { Tutorial } from './Tutorial';

const rates = new RendererRates();
const LINE_PX = 31;
const PAD_X = 36;

function Highlighted({ text, spans }: { text: string; spans: HighlightSpan[] }) {
  const parts: React.ReactNode[] = [];
  let pos = 0;
  spans.forEach((s, i) => {
    if (s.start > pos) parts.push(text.slice(pos, s.start));
    if (s.end > s.start) parts.push(<span key={i} className={`tok-${s.cls}`}>{text.slice(s.start, s.end)}</span>);
    pos = Math.max(pos, s.end);
  });
  if (pos < text.length) parts.push(text.slice(pos));
  return <>{parts}</>;
}

/** the note split into readable steps ("5,000 → 4,500 (−10% = 500) → 5,310 (+ GST 18% = 810) · taxable value 4,500") */
function explain(note: string): string[] {
  return note
    .split(' · ')
    .flatMap((part) => (part.includes(' → ') ? part.split(' → ').map((p, i) => (i === 0 ? `start ${p}` : `→ ${p}`)) : [part]))
    .filter(Boolean);
}

/**
 * One result row. Click copies the answer; double-click opens the working (every step, rate, source).
 * The note is drawn inline only when it fits between the expression and the result.
 */
function ResultRow({ r, text, charW, width, rows, open, onCopy, onToggle }: { r: LineResult; text: string; charW: number; width: number; rows: number; open: boolean; onCopy: (t: string) => void; onToggle: () => void }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 900);
    return () => clearTimeout(t);
  }, [copied]);
  const valueW = r.ok ? r.display.length * charW : 0;
  const avail = rows > 1 ? 0 : width - text.length * charW - valueW - 28;
  const showNote = !!r.note && avail > 90 && !open;
  const tip = r.note ? 'click: copy · double-click: show the working' : 'click: copy';
  const clickTimer = useRef<number | undefined>(undefined);
  const onClick = () => {
    window.clearTimeout(clickTimer.current);
    clickTimer.current = window.setTimeout(() => {
      onCopy(r.display);
      setCopied(true);
    }, 180);
  };
  const onDouble = () => {
    window.clearTimeout(clickTimer.current);
    onToggle();
  };
  return (
    <div className={`row${open ? ' open' : ''}`} style={{ height: rows * LINE_PX }}>
      {showNote && (
        <span className={`note${r.ok ? '' : ' hint'}`} style={{ maxWidth: avail }} title={r.note}>
          {r.note}
        </span>
      )}
      {!showNote && !r.ok && r.note && (
        <span className="note hint pill" title={r.note} onDoubleClick={onDouble}>
          {r.note.length > 28 ? '? ' + r.note.slice(0, 26) + '…' : r.note}
        </span>
      )}
      {r.ok && (
        <span className={`value${copied ? ' copied' : ''}`} onClick={onClick} onDoubleClick={onDouble} title={tip}>
          {r.display}
        </span>
      )}
      {open && (
        <div className="details" onClick={(e) => e.stopPropagation()}>
          <div className="details-head">
            <span className="details-expr">{text}</span>
            <button className="mini" onClick={() => onToggle()} title="close">
              ✕
            </button>
          </div>
          {r.ok && (
            <div className="details-result">
              <span>{r.display}</span>
              <button className="mini" onClick={() => onCopy(r.display)}>
                copy
              </button>
            </div>
          )}
          <ul className="details-steps">
            {(r.note ? explain(r.note) : [r.ok ? 'direct evaluation, nothing to explain' : 'could not be calculated']).map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
          {r.note && (
            <button className="mini wide" onClick={() => onCopy(`${text} = ${r.display}\n${explain(r.note!).join('\n')}`)}>
              copy the working
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export function App() {
  const [lines, setLines] = useState<HistoryLine[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [ratesVersion, setRatesVersion] = useState(0);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [hotkeyError, setHotkeyError] = useState<string | undefined>();
  const [showSettings, setShowSettings] = useState(false);
  const [showTutorial, setShowTutorial] = useState(false);
  const [hotkeyDraft, setHotkeyDraft] = useState('');
  const [updateDraft, setUpdateDraft] = useState('');
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [update, setUpdate] = useState<UpdateCheck | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLSpanElement>(null);
  const [metrics, setMetrics] = useState({ charW: 9, width: 364 });
  const saveTimer = useRef<number | undefined>(undefined);
  const linesRef = useRef(lines);
  linesRef.current = lines;

  // ---- load history & settings
  useEffect(() => {
    rates.onChange = () => setRatesVersion((v) => v + 1);
    void api.history.load().then((h) => {
      const pruned = pruneExpired(h, Date.now());
      setLines(pruned.length ? pruned : [{ id: newId(), text: '', createdAt: Date.now() }]);
      setLoaded(true);
    });
    void api.settings.get().then((r) => {
      setSettings(r.settings);
      setHotkeyDraft(r.settings.hotkey);
      setUpdateDraft(r.settings.updateUrl);
      setHotkeyError(r.hotkeyError);
      setSettingsLoaded(true);
      if (!r.settings.tutorialSeen) setShowTutorial(true);
    });
    void api.app.info().then((i) => setInfo(i));
    return api.onShow(() => {
      textareaRef.current?.focus();
    });
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = settings.theme;
  }, [settings.theme]);

  // ---- glyph width + editor width (monospace, so note space = chars × glyph width)
  useEffect(() => {
    const measure = () => {
      const m = measureRef.current;
      const ed = editorRef.current;
      if (!m || !ed) return;
      const charW = m.getBoundingClientRect().width / 10;
      setMetrics({ charW, width: ed.clientWidth - PAD_X * 2 });
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (editorRef.current) ro.observe(editorRef.current);
    if (document.fonts?.ready) void document.fonts.ready.then(measure);
    return () => ro.disconnect();
  }, []);

  // ---- expiry sweep every 30s
  useEffect(() => {
    const t = setInterval(() => {
      const pruned = pruneExpired(linesRef.current, Date.now());
      if (pruned.length !== linesRef.current.length) {
        setLines(pruned.length ? pruned : [{ id: newId(), text: '', createdAt: Date.now() }]);
      }
    }, 30_000);
    return () => clearInterval(t);
  }, []);

  // ---- persist (debounced)
  useEffect(() => {
    if (!loaded) return;
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => void api.history.save(lines), 250);
    return () => window.clearTimeout(saveTimer.current);
  }, [lines, loaded]);

  const texts = useMemo(() => lines.map((l) => l.text), [lines]);
  const text = useMemo(() => texts.join('\n'), [texts]);
  const results = useMemo(() => {
    void ratesVersion;
    return evaluateDocument(texts, { rates });
  }, [texts, ratesVersion]);

  // Reserve room on the right for the widest result; longer expressions wrap underneath (monospace, so
  // the number of wrapped rows per line is exact: ceil(chars / charsPerLine)).
  const layout = useMemo(() => {
    const widest = results.reduce((m, r) => Math.max(m, r.ok ? r.display.length : 0), 0);
    const reserve = Math.max(60, Math.ceil(widest * metrics.charW) + 24);
    const charsPerLine = Math.max(8, Math.floor((metrics.width - reserve) / metrics.charW));
    const rows = texts.map((t) => Math.max(1, Math.ceil(t.length / charsPerLine)));
    return { reserve, charsPerLine, rows };
  }, [results, texts, metrics]);

  const onChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const next = e.target.value.split('\n');
    setLines((prev) => syncLines(prev, next, Date.now()));
  }, []);

  // keep the textarea sized to its content so the outer .doc scrolls
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = '0px';
    ta.style.height = `${Math.max(ta.scrollHeight, LINE_PX * 3)}px`;
  }, [text, layout.reserve, metrics.width]);

  const textStyle: React.CSSProperties = { paddingRight: PAD_X + layout.reserve };

  const copy = useCallback((t: string) => api.clipboard.write(t), []);

  /** expression and answer for each line in [from, to) */
  const linesWithResults = useCallback(
    (from: number, to: number) => texts.slice(from, to).map((t, k) => (results[from + k]?.ok ? `${t} = ${results[from + k].display}` : t)).join('\n'),
    [texts, results],
  );

  // Ctrl+C over several lines (or select-all) copies the answers too; a partial single-line selection copies plain text
  const onCopy = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const ta = e.currentTarget;
    if (ta.selectionStart === ta.selectionEnd) return;
    const startLine = text.slice(0, ta.selectionStart).split('\n').length - 1;
    const endLine = text.slice(0, ta.selectionEnd).split('\n').length - 1;
    if (startLine === endLine) return;
    e.preventDefault();
    e.clipboardData.setData('text/plain', linesWithResults(startLine, endLine + 1));
  };

  const currentLineIndex = (): number => {
    const ta = textareaRef.current;
    if (!ta) return -1;
    return text.slice(0, ta.selectionStart).split('\n').length - 1;
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      if (openId) setOpenId(null);
      else if (showSettings) setShowSettings(false);
      else if (!settings.widgetMode) api.window.hide();
      return;
    }
    if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'c') {
      e.preventDefault();
      const r = results[currentLineIndex()];
      if (r?.ok) copy(r.display);
      return;
    }
    if (e.ctrlKey && e.altKey && e.key.toLowerCase() === 'c') {
      e.preventDefault();
      copy(linesWithResults(0, texts.length));
      return;
    }
    if (e.ctrlKey && e.altKey && e.key === 'Backspace') {
      e.preventDefault();
      setLines([{ id: newId(), text: '', createdAt: Date.now() }]);
      return;
    }
    if (e.ctrlKey && e.key === 'Enter') {
      // Ctrl+Enter: copy current result and move to a new line
      e.preventDefault();
      const idx = currentLineIndex();
      const r = results[idx];
      if (r?.ok) copy(r.display);
      const ta = textareaRef.current!;
      const lineEnd = text.indexOf('\n', ta.selectionStart);
      const pos = lineEnd === -1 ? text.length : lineEnd;
      const nextText = text.slice(0, pos) + '\n' + text.slice(pos);
      setLines((prev) => syncLines(prev, nextText.split('\n'), Date.now()));
      requestAnimationFrame(() => {
        ta.selectionStart = ta.selectionEnd = pos + 1;
      });
    }
  };

  const updateSettings = async (patch: Partial<Settings>) => {
    const r = await api.settings.set(patch);
    setSettings(r.settings);
    setHotkeyError(r.hotkeyError);
    if (!r.hotkeyError) setHotkeyDraft(r.settings.hotkey);
  };

  const onHotkeyKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return;
    if (e.key === 'Escape') {
      setHotkeyDraft(settings.hotkey);
      return;
    }
    const mods: string[] = [];
    if (e.ctrlKey) mods.push('Control');
    if (e.altKey) mods.push('Alt');
    if (e.shiftKey) mods.push('Shift');
    if (e.metaKey) mods.push('Super');
    let key = e.key;
    if (key === ' ') key = 'Space';
    else if (key.length === 1) key = key.toUpperCase();
    else if (/^Arrow/.test(key)) key = key.replace('Arrow', '');
    const accel = [...mods, key].join('+');
    setHotkeyDraft(accel);
    if (mods.length > 0) void updateSettings({ hotkey: accel });
  };

  const finishTutorial = useCallback(() => {
    setShowTutorial(false);
    void updateSettings({ tutorialSeen: true });
    textareaRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const checkUpdate = async () => {
    setUpdate({ current: info?.version ?? '', status: 'checking…' });
    setUpdate(await api.app.checkUpdate());
  };

  const widget = settings.widgetMode;

  return (
    <div className={`app${widget ? ' widget' : ''}`} onClick={() => openId && setOpenId(null)}>
      <div className="titlebar">
        <div className="brand" title="FATAAK — Think it. Type it. Fataak.">
          <svg className="mark" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M13 2 4 14h7l-1 8 9-12h-7z" fill="currentColor" />
          </svg>
          <span className="wordmark">FATAAK</span>
          {info && <span className="version" title={`build ${info.buildDate}`}>v{info.version}</span>}
          {widget && <span className="chip" title="Widget mode: pinned to the desktop, no taskbar entry, cannot be moved or minimised. Turn it off in the bar below.">widget</span>}
        </div>
        {!widget && (
          <div className="controls">
            <button className="wc" title="Minimise" onClick={() => api.window.minimize()} tabIndex={-1}>
              <svg width="12" height="12" viewBox="0 0 12 12">
                <path d="M2 6.5h8" stroke="currentColor" strokeWidth="1.2" />
              </svg>
            </button>
            <button className="wc" title="Maximise" onClick={() => api.window.toggleMaximize()} tabIndex={-1}>
              <svg width="12" height="12" viewBox="0 0 12 12">
                <rect x="2.5" y="2.5" width="7" height="7" rx="1" fill="none" stroke="currentColor" strokeWidth="1.2" />
              </svg>
            </button>
            <button className="wc close" title="Close" onClick={() => api.window.close()} tabIndex={-1}>
              <svg width="12" height="12" viewBox="0 0 12 12">
                <path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" strokeWidth="1.2" />
              </svg>
            </button>
          </div>
        )}
      </div>

      <div className="doc" onClick={(e) => e.target === e.currentTarget && textareaRef.current?.focus()}>
        <div className="editor" ref={editorRef}>
          <span className="measure" ref={measureRef} aria-hidden="true">
            0123456789
          </span>
          <pre className="highlight" aria-hidden="true" style={textStyle}>
            {texts.map((t, i) => (
              <React.Fragment key={lines[i]?.id ?? i}>
                <Highlighted text={t} spans={results[i]?.spans ?? []} />
                {i < texts.length - 1 ? '\n' : ''}
              </React.Fragment>
            ))}
            {'\n'}
          </pre>
          <textarea
            ref={textareaRef}
            value={text}
            onChange={onChange}
            onKeyDown={onKeyDown}
            onCopy={onCopy}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            autoComplete="off"
            autoFocus
            placeholder={texts.length === 1 && !texts[0] ? 'type a calculation… e.g. 25% of 480, 2 gb at 50 mbps, 100 usd in inr' : undefined}
            style={textStyle}
          />
          <div className="results">
            {results.map((r, i) => (
              <ResultRow
                key={lines[i]?.id ?? i}
                r={r}
                text={texts[i]}
                charW={metrics.charW}
                width={metrics.width}
                rows={layout.rows[i]}
                open={openId === (lines[i]?.id ?? String(i))}
                onCopy={copy}
                onToggle={() => setOpenId((cur) => (cur === (lines[i]?.id ?? String(i)) ? null : (lines[i]?.id ?? String(i))))}
              />
            ))}
          </div>
        </div>
      </div>

      <div className="bar">
        <div className="bar-left">
          <button
            className={`toggle${settings.alwaysOnTop && !widget ? ' on' : ''}`}
            title="Keep FATAAK above other windows"
            disabled={widget}
            onClick={() => void updateSettings({ alwaysOnTop: !settings.alwaysOnTop })}
            tabIndex={-1}
          >
            <span className="knob" />
            <span className="lbl">On top</span>
          </button>
          <button
            className={`toggle${widget ? ' on' : ''}`}
            title={widget ? 'Widget mode is on: click to let the window move, minimise and close again' : 'Widget mode: pin FATAAK to the desktop with no taskbar entry; it cannot be moved, minimised or closed until you turn this off'}
            onClick={() => void updateSettings({ widgetMode: !widget })}
            tabIndex={-1}
          >
            <span className="knob" />
            <span className="lbl">Widget</span>
          </button>
          <button className="toggle plain" title={settings.theme === 'dark' ? 'Switch to the light theme' : 'Switch to the dark theme'} onClick={() => void updateSettings({ theme: settings.theme === 'dark' ? 'light' : 'dark' })} tabIndex={-1}>
            <span className="lbl">{settings.theme === 'dark' ? '☾ Dark' : '☀ Light'}</span>
          </button>
        </div>
        <div className="bar-right">
          <button className="toggle plain" title="Watch the tutorial again" onClick={() => setShowTutorial(true)} tabIndex={-1}>
            <span className="lbl">? Help</span>
          </button>
          <button className={`toggle plain${showSettings ? ' on' : ''}`} title="Settings" onClick={() => setShowSettings((s) => !s)} tabIndex={-1}>
            <span className="lbl">⚙ Settings</span>
          </button>
        </div>
      </div>

      {showSettings && (
        <div className="settings" onKeyDown={(e) => e.key === 'Escape' && setShowSettings(false)} onClick={(e) => e.stopPropagation()}>
          <div className="srow">
            <span>Global hotkey</span>
            <input type="text" value={hotkeyDraft} onKeyDown={onHotkeyKeyDown} onChange={() => {}} title="press a key combination" />
          </div>
          {hotkeyError && <div className="err">{hotkeyError}</div>}
          <div className="srow">
            <span>System tray icon</span>
            <input type="checkbox" checked={settings.tray} onChange={(e) => void updateSettings({ tray: e.target.checked })} />
          </div>
          <div className="srow">
            <span>Close hides to tray</span>
            <input type="checkbox" checked={settings.closeToTray} disabled={!settings.tray} onChange={(e) => void updateSettings({ closeToTray: e.target.checked })} />
          </div>
          <div className="srow">
            <span>Always on top</span>
            <input type="checkbox" checked={settings.alwaysOnTop} disabled={widget} onChange={(e) => void updateSettings({ alwaysOnTop: e.target.checked })} />
          </div>
          <div className="srow">
            <span title="Pinned to the desktop, no taskbar entry, cannot be moved, minimised or closed until turned off">Desktop widget mode</span>
            <input type="checkbox" checked={widget} onChange={(e) => void updateSettings({ widgetMode: e.target.checked })} />
          </div>
          <div className="srow">
            <span>Theme</span>
            <select value={settings.theme} onChange={(e) => void updateSettings({ theme: e.target.value as Settings['theme'] })}>
              <option value="dark">dark</option>
              <option value="light">light</option>
            </select>
          </div>
          <div className="srow sep">
            <span>Update URL</span>
            <input type="text" value={updateDraft} placeholder="https://…/latest.json" onChange={(e) => setUpdateDraft(e.target.value)} onBlur={() => void updateSettings({ updateUrl: updateDraft.trim() })} title='a JSON file: { "version": "0.3.0", "url": "https://…" }' />
          </div>
          <div className="srow">
            <button className="link" onClick={() => void checkUpdate()}>
              Check for updates
            </button>
            <span className="muted">{update ? update.status : info ? `v${info.version} · built ${info.buildDate}` : ''}</span>
          </div>
          {update?.url && (
            <div className="srow">
              <a className="link" href={update.url} target="_blank" rel="noreferrer">
                Download {update.latest}
              </a>
            </div>
          )}
          <div className="srow sep">
            <button className="link" onClick={() => copy(linesWithResults(0, texts.length))}>
              Copy all
            </button>
            <button className="link" onClick={() => setLines([{ id: newId(), text: '', createdAt: Date.now() }])}>
              Clear all
            </button>
            <button className="link" onClick={() => setShowTutorial(true)}>
              Tutorial
            </button>
            {isElectron && !widget && (
              <button className="link" onClick={() => api.window.quit()}>
                Quit
              </button>
            )}
          </div>
          <div className="muted">Esc hides · click a result to copy · double-click for the working · Ctrl+Alt+C copies all · lines expire after 24h</div>
        </div>
      )}

      {showTutorial && settingsLoaded && <Tutorial onDone={finishTutorial} />}
    </div>
  );
}
