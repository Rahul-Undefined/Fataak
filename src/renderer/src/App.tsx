import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { evaluateDocument, pruneExpired, syncLines, newId, type HistoryLine, type LineResult, type HighlightSpan } from '../../engine/index';
import type { Settings } from '../../shared/api';
import { DEFAULT_SETTINGS } from '../../shared/api';
import { api, isElectron } from './bridge';
import { RendererRates } from './rates';

const rates = new RendererRates();
const LINE_PX = 31;
const PAD_X = 48;

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

/**
 * One result row. The note (rate timestamp, breakdown, hint) is only drawn when it fits in the
 * gap between the expression and the result; it is always available as a tooltip on the result.
 */
function ResultRow({ r, text, charW, width, rows, onCopy }: { r: LineResult; text: string; charW: number; width: number; rows: number; onCopy: (t: string) => void }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 900);
    return () => clearTimeout(t);
  }, [copied]);
  const valueW = r.ok ? r.display.length * charW : 0;
  const avail = rows > 1 ? 0 : width - text.length * charW - valueW - 28;
  const showNote = !!r.note && avail > 70;
  const tip = r.note ? `${r.display}${r.display ? ' · ' : ''}${r.note}` : 'click to copy';
  return (
    <div className="row" style={{ height: rows * LINE_PX }}>
      {showNote && (
        <span className={`note${r.ok ? '' : ' hint'}`} style={{ maxWidth: avail }} title={r.note}>
          {r.note}
        </span>
      )}
      {!showNote && !r.ok && r.note && (
        <span className="note hint" title={r.note}>
          ?
        </span>
      )}
      {r.ok && (
        <span
          className={`value${copied ? ' copied' : ''}`}
          onClick={() => {
            onCopy(r.display);
            setCopied(true);
          }}
          title={tip}
        >
          {r.display}
        </span>
      )}
    </div>
  );
}

export function App() {
  const [lines, setLines] = useState<HistoryLine[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [ratesVersion, setRatesVersion] = useState(0);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [hotkeyError, setHotkeyError] = useState<string | undefined>();
  const [showSettings, setShowSettings] = useState(false);
  const [hotkeyDraft, setHotkeyDraft] = useState('');
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
      setHotkeyError(r.hotkeyError);
    });
    return api.onShow(() => {
      textareaRef.current?.focus();
    });
  }, []);

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

  const currentLineIndex = (): number => {
    const ta = textareaRef.current;
    if (!ta) return -1;
    return text.slice(0, ta.selectionStart).split('\n').length - 1;
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      if (showSettings) setShowSettings(false);
      else api.window.hide();
      return;
    }
    if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'c') {
      // copy result of the current line
      e.preventDefault();
      const r = results[currentLineIndex()];
      if (r?.ok) copy(r.display);
      return;
    }
    if (e.ctrlKey && e.altKey && e.key.toLowerCase() === 'c') {
      e.preventDefault();
      copy(texts.map((t, i) => (results[i]?.ok ? `${t} = ${results[i].display}` : t)).join('\n'));
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

  return (
    <div className="app">
      <div className="titlebar">
        <div className="lights">
          <button className="light close" title="Close" onClick={() => api.window.close()} tabIndex={-1} />
          <button className="light min" title="Minimize" onClick={() => api.window.minimize()} tabIndex={-1} />
          <button className="light max" title="Zoom" onClick={() => api.window.toggleMaximize()} tabIndex={-1} />
        </div>
        FATAAK
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
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            autoComplete="off"
            autoFocus
            style={textStyle}
          />
          <div className="results">
            {results.map((r, i) => (
              <ResultRow key={lines[i]?.id ?? i} r={r} text={texts[i]} charW={metrics.charW} width={metrics.width} rows={layout.rows[i]} onCopy={copy} />
            ))}
          </div>
        </div>
      </div>

      <div className="footer">
        <button
          className={`icon-btn${settings.alwaysOnTop ? ' on' : ''}`}
          title={settings.alwaysOnTop ? 'Always on top: on' : 'Always on top: off'}
          onClick={() => void updateSettings({ alwaysOnTop: !settings.alwaysOnTop })}
          tabIndex={-1}
        >
          <svg width="22" height="12" viewBox="0 0 22 12" fill="none" stroke="currentColor" strokeWidth="1.5">
            <rect x="1" y="1" width="20" height="10" rx="5" />
            {settings.alwaysOnTop ? <circle cx="16" cy="6" r="2.5" fill="currentColor" stroke="none" /> : <circle cx="6" cy="6" r="2.5" />}
          </svg>
        </button>
        <button className={`icon-btn${showSettings ? ' on' : ''}`} title="Settings" onClick={() => setShowSettings((s) => !s)} tabIndex={-1}>
          <svg width="20" height="12" viewBox="0 0 20 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M1 6h17M13 1l5 5-5 5" />
          </svg>
        </button>
      </div>

      {showSettings && (
        <div className="settings" onKeyDown={(e) => e.key === 'Escape' && setShowSettings(false)}>
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
            <input type="checkbox" checked={settings.alwaysOnTop} onChange={(e) => void updateSettings({ alwaysOnTop: e.target.checked })} />
          </div>
          <div className="srow sep">
            <button className="link" onClick={() => copy(texts.map((t, i) => (results[i]?.ok ? `${t} = ${results[i].display}` : t)).join('\n'))}>
              Copy all
            </button>
            <button className="link" onClick={() => setLines([{ id: newId(), text: '', createdAt: Date.now() }])}>
              Clear all
            </button>
            {isElectron && (
              <button className="link" onClick={() => api.window.quit()}>
                Quit
              </button>
            )}
          </div>
          <div className="muted">Esc hides · Ctrl+Shift+C copies result · lines expire after 24h</div>
        </div>
      )}
    </div>
  );
}
