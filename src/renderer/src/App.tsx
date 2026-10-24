import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { evaluateDocument, pruneExpired, syncLines, newId, type HistoryLine, type LineResult, type HighlightSpan, type TeachRule } from '../../engine/index';
import { Decimal } from '../../engine/types';
import { formatQuantity } from '../../engine/format';
import type { AppInfo, Settings, Unanswered, UpdateCheck, UpdateProgress } from '../../shared/api';
import { DEFAULT_SETTINGS } from '../../shared/api';
import { FONTS, TINTS, fontByKey } from '../../shared/fonts';
import { api, isElectron } from './bridge';
import { RendererRates } from './rates';
import { Tutorial } from './Tutorial';
import { SuggestChips, TeachPanel, UnansweredPanel } from './Learn';
import { WhatsNew } from './WhatsNew';

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
function ResultRow({ r, text, rows, open, onCopy, onToggle, onHover }: { r: LineResult; text: string; rows: number; open: boolean; onCopy: (t: string) => void; onToggle: () => void; onHover: (over: boolean) => void }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 900);
    return () => clearTimeout(t);
  }, [copied]);
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
    <div className={`row${open ? ' open' : ''}`} style={{ height: rows * LINE_PX }} onMouseEnter={() => onHover(true)} onMouseLeave={() => onHover(false)}>
      {!r.ok && r.note && (
        <span className="note hint pill" title={r.note} onDoubleClick={onDouble}>
          ?
        </span>
      )}
      {r.ok && (
        <span key={r.display} className={`value${copied ? ' copied' : ''}`} onClick={onClick} onDoubleClick={onDouble} title={tip}>
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
  const [progress, setProgress] = useState<UpdateProgress | null>(null);
  const [installMsg, setInstallMsg] = useState('');
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [whatsNew, setWhatsNew] = useState<{ since?: string } | null>(null);
  const [update, setUpdate] = useState<UpdateCheck | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [caretLine, setCaretLine] = useState(0);
  const [hoverLine, setHoverLine] = useState<number | null>(null);
  const [selLines, setSelLines] = useState<[number, number] | null>(null);
  const [rules, setRules] = useState<TeachRule[]>([]);
  const [unanswered, setUnanswered] = useState<Unanswered[]>([]);
  const [teachFor, setTeachFor] = useState<string | null>(null);
  const [showLog, setShowLog] = useState(false);
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
      setSettingsLoaded(true);
      if (!r.settings.tutorialSeen) setShowTutorial(true);
    });
    void Promise.all([api.app.info(), api.settings.get()]).then(([i, s]) => {
      setInfo(i);
      if (i?.lastUpdate?.includes('failed')) {
        setToast(i.lastUpdate);
        window.setTimeout(() => setToast(null), 20000);
      }
      const seen = s.settings.lastSeenVersion;
      if (i && i.version && i.version !== 'dev' && seen !== i.version) {
        // a fresh install shows the tutorial instead; an update shows what changed
        if (seen) setWhatsNew({ since: seen });
        void api.settings.set({ lastSeenVersion: i.version });
      }
    });
    void api.teach.load().then(setRules);
    void api.unanswered.load().then(setUnanswered);
    // a quiet check once at start-up (installed app only); an update shows as a chip in the title bar
    const t = window.setTimeout(() => {
      if (isElectron) void api.app.checkUpdate().then((u) => u.url && setUpdate(u));
    }, 8000);
    const offProgress = api.app.onUpdateProgress(setProgress);
    const offShow = api.onShow(() => {
      textareaRef.current?.focus();
    });
    return () => {
      window.clearTimeout(t);
      offProgress();
      offShow();
    };
  }, []);

  useEffect(() => {
    const el = document.documentElement;
    el.dataset.theme = settings.theme;
    el.dataset.glass = info?.glass ? 'yes' : 'no';
    el.style.setProperty('--tint', settings.tint);
    el.style.setProperty('--font-ui', fontByKey(settings.uiFont, 'ui').css);
    el.style.setProperty('--font-mono', fontByKey(settings.editorFont, 'mono').css);
  }, [settings.theme, settings.tint, settings.uiFont, settings.editorFont, info?.glass]);

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
    return evaluateDocument(texts, { rates, rules });
  }, [texts, ratesVersion, rules]);

  // ---- unanswered log: a line that stayed not-understood for a few seconds (and is not being typed) is recorded
  const logTimer = useRef<number | undefined>(undefined);
  const logged = useRef(new Map<string, number>());
  const recordUnanswered = useCallback(
    () => {
      const items: { text: string; hint: string }[] = [];
      const now = Date.now();
      results.forEach((r, i) => {
        const t = texts[i]?.trim() ?? '';
        if (r.ok || r.isText || t.length < 3 || !/\d|[\p{L}]{3,}/u.test(t)) return;
        const last = logged.current.get(t) ?? 0;
        if (now - last < 60_000) return;
        logged.current.set(t, now);
        items.push({ text: t, hint: r.note ?? r.display ?? '' });
      });
      if (items.length) void api.unanswered.add(items).then(() => api.unanswered.load().then(setUnanswered));
    },
    [results, texts],
  );
  useEffect(() => {
    window.clearTimeout(logTimer.current);
    logTimer.current = window.setTimeout(() => recordUnanswered(), 5000);
    return () => window.clearTimeout(logTimer.current);
  }, [recordUnanswered]);

  const saveRules = useCallback((next: TeachRule[]) => void api.teach.save(next).then(setRules), []);
  const replaceLine = (idx: number, newText: string) => {
    const next = texts.slice();
    next[idx] = newText;
    setLines((prev) => syncLines(prev, next, Date.now()));
    requestAnimationFrame(() => {
      const ta = textareaRef.current;
      if (!ta) return;
      const pos = next.slice(0, idx + 1).join('\n').length;
      ta.focus();
      ta.selectionStart = ta.selectionEnd = pos;
    });
  };

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

  const trackSelection = () => {
    const ta = textareaRef.current;
    if (!ta) return;
    setCaretLine(currentLineIndex());
    if (ta.selectionStart === ta.selectionEnd) setSelLines(null);
    else {
      const a = text.slice(0, ta.selectionStart).split('\n').length - 1;
      const b = text.slice(0, ta.selectionEnd).split('\n').length - 1;
      setSelLines(a === b ? null : [a, b]);
    }
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
    setUpdate({ current: info?.version ?? '', status: 'checking…', canInstall: false });
    setUpdate(await api.app.checkUpdate());
  };
  const install = async () => {
    if (!update?.url || !update.latest) return;
    setInstallMsg('starting download…');
    const r = await api.app.installUpdate(update.url, update.latest);
    setInstallMsg(r.status);
  };
  const progressText = progress ? (progress.phase === 'downloading' ? `downloading ${progress.total ? Math.round((progress.received / progress.total) * 100) + '%' : Math.round(progress.received / 1e6) + ' MB'}` : progress.phase === 'extracting' ? 'extracting…' : 'restarting FATAAK…') : installMsg;

  const widget = settings.widgetMode;
  const statusIdx = hoverLine ?? caretLine;
  const statusRes = results[statusIdx];
  let statusNote = statusRes?.note ?? null;
  let statusLabel = statusRes?.ok ? statusRes.display : statusRes?.note ? 'not calculated' : '';
  // several selected lines: their total, average and count in the strip
  if (selLines && hoverLine === null) {
    const vals = results.slice(selLines[0], selLines[1] + 1).filter((r) => r.ok && r.value && (r.value.kind === 'number' || r.value.kind === 'money'));
    if (vals.length) {
      const same = vals.every((r) => r.value!.kind === vals[0].value!.kind && r.value!.currency === vals[0].value!.currency);
      if (same) {
        const sum = vals.reduce((s, r) => s.plus(r.value!.value), new Decimal(0));
        const q = { ...vals[0].value!, value: sum, note: undefined, display: undefined };
        statusLabel = `selection: ${vals.length} values`;
        statusNote = `sum ${formatQuantity(q)} · average ${formatQuantity({ ...q, value: sum.div(vals.length).toDecimalPlaces(2) })}`;
      }
    }
  }

  return (
    <div className={`app${widget ? ' widget' : ''}`} onClick={() => openId && setOpenId(null)}>
      <div className="titlebar">
        <div className="brand" title="FATAAK — Think it. Type it. Fataak.">
          <svg className="mark" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M13 2 4 14h7l-1 8 9-12h-7z" fill="currentColor" />
          </svg>
          <span className="wordmark">FATAAK</span>
          {widget && <span className="chip" title="Widget mode: pinned to the desktop, no taskbar entry, cannot be moved or minimised. Turn it off in the bar below.">widget</span>}
          {toast && (
            <span className={`chip${toast.includes('failed') ? ' bad' : ' good'}`} title={toast}>
              {toast.includes('failed') ? '✕' : '✓'} {toast}
            </span>
          )}
          {update?.url && !widget && (
            <button className="chip update" title="Click to install" onClick={() => setShowSettings(true)} tabIndex={-1}>
              v{update.latest} available
            </button>
          )}
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
            onKeyUp={() => trackSelection()}
            onClick={() => trackSelection()}
            onSelect={() => trackSelection()}
            onCopy={onCopy}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            autoComplete="off"
            autoFocus
            placeholder={texts.length === 1 && !texts[0] ? (metrics.width < 380 ? 'type a calculation…' : 'type a calculation… e.g. 25% of 480, 2 gb at 50 mbps, 100 usd in inr') : undefined}
            style={textStyle}
          />
          <div className="results">
            {results.map((r, i) => (
              <ResultRow
                key={lines[i]?.id ?? i}
                r={r}
                text={texts[i]}
                rows={layout.rows[i]}
                onHover={(over) => setHoverLine(over ? i : null)}
                open={openId === (lines[i]?.id ?? String(i))}
                onCopy={copy}
                onToggle={() => setOpenId((cur) => (cur === (lines[i]?.id ?? String(i)) ? null : (lines[i]?.id ?? String(i))))}
              />
            ))}
          </div>
        </div>
      </div>

      {statusRes && !statusRes.ok && !statusRes.isText && (texts[statusIdx]?.trim().length ?? 0) >= 3 && hoverLine === null ? (
        <SuggestChips line={texts[statusIdx]} onPick={(t) => replaceLine(statusIdx, t)} onTeach={() => setTeachFor(texts[statusIdx])} />
      ) : null}
      <div className="status" title={statusNote ?? ''}>
        {statusNote ? (
          <>
            <span className="status-k">{statusLabel}</span>
            <span className="status-v">{statusNote}</span>
          </>
        ) : (
          <span className="status-k muted">{texts.length > 1 || texts[0] ? 'double-click a result for the working · FATAAK is still learning and can make mistakes' : ''}</span>
        )}
      </div>

      <div className="bar">
        <div className="bar-left">
          <button
            className={`toggle${settings.alwaysOnTop && !widget ? ' on' : ''}`}
            title="On top"
            disabled={widget}
            onClick={() => void updateSettings({ alwaysOnTop: !settings.alwaysOnTop })}
            tabIndex={-1}
          >
            <span className="knob" />
            <span className="lbl txt">On top</span>
          </button>
          <button
            className={`toggle${widget ? ' on' : ''}`}
            title="Widget mode"
            onClick={() => void updateSettings({ widgetMode: !widget })}
            tabIndex={-1}
          >
            <span className="knob" />
            <span className="lbl txt">Widget</span>
          </button>
          <button className="toggle plain" title="Theme" onClick={() => void updateSettings({ theme: settings.theme === 'dark' ? 'light' : settings.theme === 'light' ? 'star' : 'dark' })} tabIndex={-1}>
            <span className="lbl">
              <span className="ico">{settings.theme === 'dark' ? '☾' : settings.theme === 'light' ? '☀' : '✦'}</span> <span className="txt">{settings.theme === 'dark' ? 'Moon' : settings.theme === 'light' ? 'Sun' : 'Star'}</span>
            </span>
          </button>
        </div>
        <div className="bar-right">
          <button className="toggle plain" title="Watch the tutorial again" onClick={() => setShowTutorial(true)} tabIndex={-1}>
            <span className="lbl">
              <span className="ico">?</span> <span className="txt">Help</span>
            </span>
          </button>
          <button className={`toggle plain${showSettings ? ' on' : ''}`} title="Settings" onClick={() => setShowSettings((s) => !s)} tabIndex={-1}>
            <span className="lbl">
              <span className="ico">⚙</span> <span className="txt">Settings</span>
            </span>
          </button>
        </div>
      </div>

      {showSettings && <div className="backdrop" onMouseDown={() => setShowSettings(false)} />}
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
          <div className="srow sep">
            <button className="link" onClick={() => void checkUpdate()} title={`looks up the latest release at github.com/${settings.updateRepo}`}>
              Check for updates
            </button>
            <span className="muted">{update ? update.status : info ? `v${info.version} · built ${info.buildDate}` : ''}</span>
          </div>
          {update?.url && (
            <div className="srow">
              {update.canInstall ? (
                <button className="primary small" onClick={() => void install()} disabled={!!progress}>
                  Install {update.latest} and restart
                </button>
              ) : (
                <a className="link" href={update.url} target="_blank" rel="noreferrer">
                  Download {update.latest}
                </a>
              )}
              <span className="muted">{progressText || (update.size ? `${Math.round(update.size / 1e6)} MB` : '')}</span>
            </div>
          )}
          <div className="srow sep">
            <span className="muted">Appearance</span>
            <span className="seg">
              {(['dark', 'light', 'star'] as const).map((t) => (
                <button key={t} className={`segb${settings.theme === t ? ' on' : ''}`} onClick={() => void updateSettings({ theme: t })}>
                  {t === 'dark' ? '☾ Moon' : t === 'light' ? '☀ Sun' : '✦ Star'}
                </button>
              ))}
            </span>
          </div>
          {settings.theme === 'star' && (
            <div className="srow">
              <span className="muted">Glass tint</span>
              <span className="swatches">
                {TINTS.map((t) => (
                  <button key={t.key} className={`swatch${settings.tint === t.hex ? ' on' : ''}`} style={{ background: t.hex }} title={t.label} onClick={() => void updateSettings({ tint: t.hex })} />
                ))}
              </span>
            </div>
          )}
          <div className="srow">
            <span className="muted">Interface font</span>
            <select value={settings.uiFont} onChange={(e) => void updateSettings({ uiFont: e.target.value })} style={{ fontFamily: fontByKey(settings.uiFont, 'ui').css }}>
              {FONTS.filter((f) => f.kind === 'ui').map((f) => (
                <option key={f.key} value={f.key} style={{ fontFamily: f.css }}>
                  {f.label}
                </option>
              ))}
            </select>
          </div>
          <div className="srow">
            <span className="muted">Editor font</span>
            <select value={settings.editorFont} onChange={(e) => void updateSettings({ editorFont: e.target.value })} style={{ fontFamily: fontByKey(settings.editorFont, 'mono').css }}>
              {FONTS.filter((f) => f.kind === 'mono').map((f) => (
                <option key={f.key} value={f.key} style={{ fontFamily: f.css }}>
                  {f.label}
                </option>
              ))}
            </select>
          </div>
          <div className="srow sep">
            <button className="link" onClick={() => (setShowSettings(false), setTeachFor(''))} title="teach FATAAK your own way of asking">
              ✎ Teach FATAAK{rules.length ? ` (${rules.length})` : ''}
            </button>
            <button className="link" onClick={() => (setShowSettings(false), setShowLog(true))} title="questions FATAAK could not answer, ready to share">
              Unanswered{unanswered.length ? ` (${unanswered.length})` : ''}
            </button>
          </div>
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
            <button className="link" onClick={() => (setShowSettings(false), setWhatsNew({}))}>
              What's new
            </button>
            {isElectron && !widget && (
              <button className="link" onClick={() => api.window.quit()}>
                Quit
              </button>
            )}
          </div>
          <div className="muted learning">FATAAK is still learning and can make mistakes.</div>
          <div className="muted credit">Made by Rahul</div>
        </div>
      )}

      {teachFor !== null && <TeachPanel rules={rules} rates={rates} prefill={teachFor} onSave={saveRules} onClose={() => (setTeachFor(null), textareaRef.current?.focus())} />}
      {showLog && (
        <UnansweredPanel
          items={unanswered}
          onExport={() => api.unanswered.exportCsv()}
          onCopy={() => void api.unanswered.csv().then((c) => copy(c))}
          onClear={() => void api.unanswered.clear().then(() => setUnanswered([]))}
          onClose={() => setShowLog(false)}
          onTeach={(t) => (setShowLog(false), setTeachFor(t))}
        />
      )}
      {whatsNew && info && <WhatsNew version={info.version} since={whatsNew.since} onClose={() => (setWhatsNew(null), textareaRef.current?.focus())} />}
      {showTutorial && settingsLoaded && <Tutorial onDone={finishTutorial} />}
    </div>
  );
}
