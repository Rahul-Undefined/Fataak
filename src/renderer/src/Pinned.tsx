import React, { useEffect, useMemo, useState } from 'react';
import { evaluateDocument, type RateProvider, type TeachRule } from '../../engine/index';

/** Esc closes the panel wherever the focus is */
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

/**
 * Pinned values: "name = value" lines that never expire and are available on every line, in every session.
 * Each line is checked live; only lines that define a name can be saved.
 */
export function PinnedPanel({ pinned, rates, rules, onSave, onClose }: { pinned: string[]; rates: RateProvider; rules: TeachRule[]; onSave: (lines: string[]) => void; onClose: () => void }) {
  const [draft, setDraft] = useState('');
  const [showHow, setShowHow] = useState(pinned.length === 0);
  useEscape(onClose);
  const check = useMemo(() => {
    const all = [...pinned, draft.trim()].filter(Boolean);
    const res = evaluateDocument(all, { rates, rules });
    return res;
  }, [pinned, draft, rates, rules]);
  const draftRes = draft.trim() ? check[check.length - 1] : null;
  const draftOk = !!draftRes && draftRes.ok && !!draftRes.label;
  const add = () => {
    if (!draftOk || !draftRes) return;
    const name = draftRes.label!;
    // a new value for the same name replaces the old pin
    const next = pinned.filter((l, i) => check[i]?.label !== name);
    onSave([...next, draft.trim()]);
    setDraft('');
  };
  return (
    <div className="modal" onClick={onClose}>
      <div className="learn" role="dialog" aria-label="Pinned values" onClick={(e) => e.stopPropagation()}>
        <div className="learn-head">
          <div>
            <h2>Pinned values</h2>
            <p className="learn-sub">Names that never expire. Available on every line, every day, until you unpin them.</p>
          </div>
          <button className="mini" onClick={onClose} title="close (Esc)">
            ✕
          </button>
        </div>
        <button className="link how" onClick={() => setShowHow((v) => !v)}>
          {showHow ? '▾ How it works' : '▸ How it works'}
        </button>
        {showHow && (
          <div className="how">
            <p>
              <b>Step 1.</b> Type a definition below, the same way you would in the editor: <code>salary = 85000</code>, <code>rent = 15000</code>, <code>rate = 9%</code>, <code>home loan = 30 lakh</code>.
            </p>
            <p>
              <b>Step 2.</b> Add it. From now on any line can use the name: <code>salary - rent</code>, <code>emi home loan at rate for 20 years</code>, <code>10% of salary</code>.
            </p>
            <p>
              <b>Step 3.</b> Lines in the editor still expire after 24 hours; pinned values do not. Hover a definition in the editor and click 📌 to pin it in one click.
            </p>
          </div>
        )}
        <label className="field">
          <span>
            <b>+</b> New pinned value
          </span>
          <div className="pin-row">
            <input value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} placeholder="e.g. salary = 85000" spellCheck={false} autoFocus />
            <button className="primary" disabled={!draftOk} onClick={add}>
              Pin
            </button>
          </div>
          <span className={`muted${draftOk ? ' ok' : ''}`}>{draft.trim() ? (draftOk ? `${draftRes!.label} = ${draftRes!.display}` : draftRes?.ok ? 'this line has no name; write "name = value"' : draftRes?.note || 'not understood yet') : ''}</span>
        </label>
        {pinned.length > 0 ? (
          <div className="rules">
            <div className="muted">Pinned ({pinned.length})</div>
            <ul>
              {pinned.map((l, i) => (
                <li key={l}>
                  <span className="rf">{l}</span>
                  <span className="arrow">→</span>
                  <span className="rt">{check[i]?.ok ? check[i].display : 'not understood'}</span>
                  <button className="mini" title="unpin" onClick={() => onSave(pinned.filter((_x, k) => k !== i))}>
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <div className="empty">Nothing pinned yet.</div>
        )}
      </div>
    </div>
  );
}
