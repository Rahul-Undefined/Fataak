import React, { useEffect } from 'react';
import { CHANGELOG, notesSince, type ReleaseNote } from '../../shared/changelog';

/** Release notes: shown once after an update (every version between the last one seen and this one), and from Settings. */
export function WhatsNew({ version, since, onClose }: { version: string; since?: string; onClose: () => void }) {
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
  let notes: ReleaseNote[] = notesSince(since, version);
  if (!notes.length) notes = CHANGELOG.slice(0, 3);
  const group = (title: string, items?: string[]) =>
    items?.length ? (
      <div className="wn-group">
        <div className="wn-title">{title}</div>
        <ul>
          {items.map((x, i) => (
            <li key={i}>{x}</li>
          ))}
        </ul>
      </div>
    ) : null;
  return (
    <div className="modal" onClick={onClose}>
      <div className="learn whatsnew" role="dialog" aria-label="What's new" onClick={(e) => e.stopPropagation()}>
        <div className="learn-head">
          <div>
            <h2>{since ? `Updated to ${version}` : `What’s new`}</h2>
            <p className="learn-sub">{since ? `Here is what changed since ${since}.` : 'Release notes, newest first.'}</p>
          </div>
          <button className="mini" onClick={onClose} title="close (Esc)">
            ✕
          </button>
        </div>
        <div className="wn-list">
          {notes.map((n) => (
            <section key={n.version} className="wn-release">
              <h3>
                {n.version} <span className="muted">{n.date}</span>
              </h3>
              {group('New', n.added)}
              {group('Changed', n.changed)}
              {group('Fixed', n.fixed)}
            </section>
          ))}
        </div>
        <div className="learn-actions">
          <button className="primary" onClick={onClose}>
            Got it
          </button>
          <span className="muted">FATAAK is still learning and can make mistakes; a wrong answer is worth a line in Settings → Unanswered.</span>
        </div>
      </div>
    </div>
  );
}
