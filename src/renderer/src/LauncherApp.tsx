import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { evaluateDocument, type LineResult, type TeachRule } from '../../engine/index';
import type { Settings } from '../../shared/api';
import { DEFAULT_SETTINGS } from '../../shared/api';
import { fontByKey } from '../../shared/fonts';
import { api } from './bridge';
import { RendererRates } from './rates';

const rates = new RendererRates();

type OrbState = 'idle' | 'listening' | 'thinking' | 'responding';

/**
 * Quick launcher: a small transparent window with a fluid orb and a glass input bar. One line in, the answer
 * out; Enter copies it and closes, Ctrl+Enter sends it to the main window. The orb breathes while idle,
 * ripples while you type, spins while a line is not understood yet, and swells when an answer lands.
 */
export function Launcher() {
  const [text, setText] = useState(window.location.hash === '#demo' ? 'emi 5 lakh at 9% for 5 years' : '');
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [rules, setRules] = useState<TeachRule[]>([]);
  const [pinned, setPinned] = useState<string[]>([]);
  const [ratesVersion, setRatesVersion] = useState(0);
  const [typingAt, setTypingAt] = useState(0);
  const [copied, setCopied] = useState(false);
  const [shown, setShown] = useState(false);
  const [epoch, setEpoch] = useState(0);
  const [closing, setClosing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const recorded = useRef(false);

  useEffect(() => {
    rates.onChange = () => setRatesVersion((v) => v + 1);
    void api.settings.get().then((r) => setSettings(r.settings));
    void api.teach.load().then(setRules);
    void api.pinned.load().then(setPinned);
    const off = api.onShow(() => {
      // fresh every time it opens; the rules and pins may have changed in the main window
      void api.teach.load().then(setRules);
      void api.pinned.load().then(setPinned);
      void api.settings.get().then((r) => setSettings(r.settings));
      setText('');
      setCopied(false);
      recorded.current = false;
      setClosing(false);
      setShown(false);
      setEpoch((n) => n + 1);
      requestAnimationFrame(() => {
        setShown(true);
        window.setTimeout(() => inputRef.current?.focus(), 1050);
      });
    });
    requestAnimationFrame(() => setShown(true));
    return off;
  }, []);

  useEffect(() => {
    const el = document.documentElement;
    el.dataset.theme = settings.theme;
    el.style.setProperty('--tint', settings.tint);
    el.style.setProperty('--font-ui', fontByKey(settings.uiFont, 'ui').css);
    el.style.setProperty('--font-mono', fontByKey(settings.editorFont, 'mono').css);
  }, [settings]);

  const result: LineResult | null = useMemo(() => {
    void ratesVersion;
    if (!text.trim()) return null;
    return evaluateDocument([text], { rates, rules, pinned })[0];
  }, [text, rules, pinned, ratesVersion]);

  // the orb state follows what is happening with the line
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!text) return;
    const t = window.setTimeout(() => setNow(Date.now()), 450);
    return () => window.clearTimeout(t);
  }, [text, typingAt]);
  const typing = text.length > 0 && now - typingAt < 400;
  const state: OrbState = !text.trim() ? 'idle' : typing ? 'listening' : result?.ok && !result.isText ? 'responding' : 'thinking';

  const hide = useCallback(() => api.launcher.hide(), []);
  /** the entrance in reverse: capsule folds into the orb, the orb returns to the centre and rises out; then hide */
  const closeWithAnimation = useCallback(() => {
    setClosing(true);
    window.setTimeout(() => {
      hide();
      setClosing(false);
    }, 1000);
  }, [hide]);
  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      // an answered line is kept in the window's history even when the launcher is dismissed
      if (text && result?.ok && !result.isText && !recorded.current) api.launcher.record(text);
      if (text) setText('');
      else closeWithAnimation();
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (e.ctrlKey) {
        recorded.current = true;
        api.launcher.openInMain(text);
        return;
      }
      if (result?.ok && !result.isText) {
        api.clipboard.write(result.display);
        if (!recorded.current) api.launcher.record(text);
        recorded.current = true;
        setCopied(true);
        window.setTimeout(closeWithAnimation, 520);
      }
    }
  };

  const answer = result?.ok && !result.isText ? result.display : null;
  const hint = result && !result.ok && !result.isText ? result.note ?? 'not understood yet' : null;

  // the orb lands at the centre of the capsule before sliding to its slot: --cx is that offset
  const stageRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const set = () => el.style.setProperty('--cx', `${Math.round(el.clientWidth / 2 - 22 - 8)}px`);
    set();
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div className={`launcher${shown ? ' in' : ''}${closing ? ' out' : ''}`} onMouseDown={(e) => e.target === e.currentTarget && inputRef.current?.focus()}>
      <div className={`stage ${state}`} ref={stageRef} key={epoch}>
        <div className="orb" aria-hidden="true">
          <div className="orb-ring" />
          <div className="orb-core" />
          <div className="orb-ripple r1" />
          <div className="orb-ripple r2" />
          <div className="orb-spark" />
        </div>
        <div className={`capsule ${state}`}>
          <input ref={inputRef} value={text} onChange={(e) => (setText(e.target.value), setTypingAt(Date.now()))} onKeyDown={onKey} placeholder="Ask FATAAK…" spellCheck={false} autoFocus autoComplete="off" />
          {answer && (
            <span key={answer} className={`answer${copied ? ' copied' : ''}`} title="Enter copies · Ctrl+Enter opens in the window">
              {answer}
            </span>
          )}
        </div>
      </div>
      <div className={`hint${answer || hint ? ' show' : ''}`}>{copied ? 'copied to the clipboard' : answer ? result?.note ?? 'Enter copies · Ctrl+Enter opens in the window' : hint}</div>
    </div>
  );
}
