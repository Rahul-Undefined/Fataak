import React, { useEffect, useMemo, useState } from 'react';
import { evaluateDocument, suggest, ruleProblem, previewRule, cleanPhrase, type TeachRule, type RateProvider } from '../../engine/index';
import type { Unanswered } from '../../shared/api';

/* ---------------------------------------------------------------- did you mean (chips under the editor) */

export function SuggestChips({ line, onPick, onTeach }: { line: string; onPick: (text: string) => void; onTeach: () => void }) {
  const items = useMemo(() => suggest(line), [line]);
  return (
    <div className="suggest">
      <span className="suggest-k">{items.length ? 'Did you mean' : 'Not understood'}</span>
      {items.map((s, i) => (
        <button key={s.text} className="chip-btn" style={{ animationDelay: `${i * 60}ms` }} onClick={() => onPick(s.text)} title="click to use this form">
          {s.text}
        </button>
      ))}
      <button className="chip-btn teach" onClick={onTeach} title="teach FATAAK your way of asking">
        ✎ Teach FATAAK
      </button>
    </div>
  );
}

/** Esc closes a panel wherever the focus is */
function useEscape(onClose: () => void): void {
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', h, true);
    return () => window.removeEventListener('keydown', h, true);
  }, [onClose]);
}

/* ---------------------------------------------------------------- teach panel */

const EXAMPLE = { from: 'mera tax kitna 15 lakh', to: 'income tax on 15 lakh salary' };

function answerOf(text: string, rules: TeachRule[], rates: RateProvider): { ok: boolean; display: string } {
  if (!text.trim()) return { ok: false, display: '' };
  const r = evaluateDocument([text], { rates, rules })[0];
  return { ok: r.ok && !r.isText, display: r.ok ? r.display : r.display || 'not understood' };
}

export function TeachPanel({ rules, rates, prefill, onSave, onClose }: { rules: TeachRule[]; rates: RateProvider; prefill: string; onSave: (rules: TeachRule[]) => void; onClose: () => void }) {
  const [from, setFrom] = useState(prefill);
  const [to, setTo] = useState('');
  const [showHow, setShowHow] = useState(rules.length === 0);
  const [saved, setSaved] = useState<string | null>(null);

  useEffect(() => setFrom(prefill), [prefill]);
  useEscape(onClose);

  const problem = ruleProblem(from, to);
  const picks = useMemo(() => suggest(from, 4), [from]);
  const target = useMemo(() => answerOf(to, rules, rates), [to, rules, rates]);
  const candidate: TeachRule | null = !problem ? { from: cleanPhrase(from), to: cleanPhrase(to), createdAt: Date.now() } : null;
  const rewritten = candidate ? previewRule(candidate.from, candidate.to, cleanPhrase(from)) : null;
  const mine = useMemo(() => (candidate ? answerOf(from, [...rules.filter((r) => r.from !== candidate.from), candidate], rates) : { ok: false, display: '' }), [from, candidate?.from, candidate?.to, rules, rates]);
  const ready = !!candidate && target.ok && mine.ok && mine.display === target.display;
  const step = !from.trim() ? 1 : !to.trim() ? 2 : 3;

  const save = () => {
    if (!candidate) return;
    const next = [...rules.filter((r) => r.from !== candidate.from), candidate];
    onSave(next);
    setSaved(candidate.from);
    setTo('');
    setFrom('');
  };

  return (
    <div className="modal" onClick={onClose}>
      <div className="learn" role="dialog" aria-label="Teach FATAAK" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === 'Escape' && onClose()}>
        <div className="learn-head">
          <div>
            <h2>Teach FATAAK</h2>
            <p className="learn-sub">Aap jaise puchte ho, waise sikhao. Ek baar sikhaya, hamesha yaad. Sab kuch aapke laptop par hi rehta hai.</p>
          </div>
          <button className="mini" onClick={onClose} title="close (Esc)">
            ✕
          </button>
        </div>

        <ol className="steps">
          <li className={step === 1 ? 'now' : step > 1 ? 'done' : ''}>
            <b>1</b> Your way
          </li>
          <li className={step === 2 ? 'now' : step > 2 ? 'done' : ''}>
            <b>2</b> FATAAK's way
          </li>
          <li className={step === 3 ? 'now' : ''}>
            <b>3</b> Check &amp; save
          </li>
        </ol>

        <button className="link how" onClick={() => setShowHow((v) => !v)}>
          {showHow ? '▾ How it works' : '▸ How it works'}
        </button>
        {showHow && (
          <div className="how">
            <p>
              <b>Step 1.</b> Type the question the way <i>you</i> ask it. Keep the numbers in; FATAAK turns them into blanks, so <code>mera tax kitna 15 lakh</code> will also answer <code>mera tax kitna 9 lakh</code>.
            </p>
            <p>
              <b>Step 2.</b> Type the same question the way FATAAK already understands it, with the <i>same numbers</i>. Not sure? Pick one of the forms FATAAK proposes under the box.
            </p>
            <p>
              <b>Step 3.</b> Both answers must match in the preview. Then save. From now on your phrasing just works; delete it any time from the list below.
            </p>
            <button
              className="chip-btn"
              onClick={() => {
                setFrom(EXAMPLE.from);
                setTo(EXAMPLE.to);
              }}
            >
              Try the example
            </button>
          </div>
        )}

        <label className="field">
          <span>
            <b>1</b> You ask like this
          </span>
          <input value={from} onChange={(e) => setFrom(e.target.value)} placeholder="e.g. mera tax kitna 15 lakh" spellCheck={false} autoFocus={!prefill} />
        </label>

        <label className="field">
          <span>
            <b>2</b> FATAAK understands this
          </span>
          <input value={to} onChange={(e) => setTo(e.target.value)} placeholder="e.g. income tax on 15 lakh salary" spellCheck={false} autoFocus={!!prefill} />
        </label>
        {!!from.trim() && picks.length > 0 && (
          <div className="picks">
            <span className="muted">forms FATAAK knows:</span>
            {picks.map((p) => (
              <button key={p.text} className={`chip-btn${cleanPhrase(to) === p.text ? ' on' : ''}`} onClick={() => setTo(p.text)}>
                {p.text}
              </button>
            ))}
          </div>
        )}

        <div className="field">
          <span>
            <b>3</b> Check
          </span>
          <div className="preview">
            <div className="prow">
              <span className="pk">FATAAK's way</span>
              <span className={`pv${target.ok ? ' ok' : ''}`}>{to.trim() ? target.display : '—'}</span>
            </div>
            <div className="prow">
              <span className="pk">Your way{rewritten && rewritten !== cleanPhrase(from) ? ` → ${rewritten}` : ''}</span>
              <span className={`pv${mine.ok ? ' ok' : ''}`}>{candidate ? mine.display : '—'}</span>
            </div>
            <div className={`verdict${ready ? ' good' : ''}`}>
              {problem && from.trim() && to.trim() ? problem : ready ? 'Both match. Save it.' : !to.trim() ? 'fill step 2' : !target.ok ? "FATAAK does not understand step 2 yet; pick a form it knows" : 'the two answers differ; check the numbers on both sides'}
            </div>
          </div>
        </div>

        <div className="learn-actions">
          <button className="primary" disabled={!ready} onClick={save}>
            Save this phrasing
          </button>
          {saved && <span className="muted">saved “{saved}” ✓</span>}
        </div>

        {rules.length > 0 && (
          <div className="rules">
            <div className="muted">Taught so far ({rules.length})</div>
            <ul>
              {rules
                .slice()
                .sort((a, b) => b.createdAt - a.createdAt)
                .map((r) => (
                  <li key={r.from}>
                    <span className="rf">{r.from}</span>
                    <span className="arrow">→</span>
                    <span className="rt">{r.to}</span>
                    <button className="mini" title="forget this" onClick={() => onSave(rules.filter((x) => x.from !== r.from))}>
                      ✕
                    </button>
                  </li>
                ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- unanswered log */

export function UnansweredPanel({ items, onExport, onCopy, onClear, onClose, onTeach }: { items: Unanswered[]; onExport: () => Promise<string | null>; onCopy: () => void; onClear: () => void; onClose: () => void; onTeach: (text: string) => void }) {
  const [status, setStatus] = useState('');
  const [showHow, setShowHow] = useState(true);
  useEscape(onClose);
  const sorted = useMemo(() => items.slice().sort((a, b) => b.lastAt - a.lastAt), [items]);
  const when = (t: number) => (t ? new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : '');
  return (
    <div className="modal" onClick={onClose}>
      <div className="learn" role="dialog" aria-label="Unanswered questions" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === 'Escape' && onClose()}>
        <div className="learn-head">
          <div>
            <h2>Unanswered questions</h2>
            <p className="learn-sub">Jo sawaal FATAAK samajh nahi paya, woh yahan apne aap save hote hain. Sirf aapke laptop par; bahar tabhi jaata hai jab aap file share karo.</p>
          </div>
          <button className="mini" onClick={onClose} title="close (Esc)">
            ✕
          </button>
        </div>

        <button className="link how" onClick={() => setShowHow((v) => !v)}>
          {showHow ? '▾ How to get these fixed' : '▸ How to get these fixed'}
        </button>
        {showHow && (
          <div className="how">
            <p>
              <b>Step 1.</b> Keep using FATAAK. Every question it could not answer lands here with how often you asked it.
            </p>
            <p>
              <b>Step 2.</b> Click <b>Export CSV</b>. A spreadsheet file is saved (Documents by default). Open it in Excel if you like and fill the last column with the answer you expected.
            </p>
            <p>
              <b>Step 3.</b> Send that file to Rahul (WhatsApp or email). Each question gets fixed in the next version. Meanwhile, <b>Teach</b> next to a question makes it work for you today.
            </p>
          </div>
        )}

        <div className="learn-actions">
          <button
            className="primary"
            disabled={!items.length}
            onClick={() => {
              setStatus('saving…');
              void onExport().then((p) => setStatus(p ? `saved: ${p}` : 'cancelled'));
            }}
          >
            Export CSV
          </button>
          <button className="chip-btn" disabled={!items.length} onClick={() => (onCopy(), setStatus('copied as CSV'))}>
            Copy CSV
          </button>
          <button className="chip-btn" disabled={!items.length} onClick={() => window.confirm('Clear the whole list?') && (onClear(), setStatus('cleared'))}>
            Clear
          </button>
          <span className="muted status-txt" title={status}>
            {status}
          </span>
        </div>

        {sorted.length === 0 ? (
          <div className="empty">Nothing here yet. Everything FATAAK answers never comes here.</div>
        ) : (
          <ul className="log">
            {sorted.map((u) => (
              <li key={u.text}>
                <span className="lq" title={u.hint || undefined}>
                  {u.text}
                </span>
                <span className="lc" title="times asked">
                  ×{u.count}
                </span>
                <span className="ld">{when(u.lastAt)}</span>
                <button className="mini" title="teach FATAAK this phrasing" onClick={() => onTeach(u.text)}>
                  ✎
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
