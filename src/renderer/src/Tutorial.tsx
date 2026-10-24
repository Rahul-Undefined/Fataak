import React, { useEffect, useRef, useState } from 'react';

/**
 * First-run walkthrough. It plays like a short video: each scene types real questions into a mock
 * editor, the answers appear, a caption explains. Autoplays, can be paused, stepped or skipped.
 */
interface Scene {
  title: string;
  caption: string;
  lines: { text: string; result: string; note?: string }[];
}

const SCENES: Scene[] = [
  {
    title: 'Type it. The answer appears.',
    caption: 'One question per line. Numbers, units and currencies are understood as you type; results sit on the right. Click a result to copy it, double-click to see how it was worked out.',
    lines: [
      { text: '25% of 480', result: '120' },
      { text: '2 gb at 50 mbps', result: '5 min 20 s' },
      { text: '(245 - 87) * 12 + 325', result: '2,221' },
    ],
  },
  {
    title: 'English or Hinglish, your way.',
    caption: 'Full sentences work. Hindi written in English letters is understood too.',
    lines: [
      { text: '500 ka 18% nikal ke total me add kar', result: '590', note: '+90 on 500' },
      { text: 'mere paas 5000 the, 1275 kharch kiye, kitna bacha', result: '3,725' },
      { text: 'what original amount becomes 57500 after a 15% increase', result: '50,000' },
    ],
  },
  {
    title: 'Money, GST, EMI, interest.',
    caption: 'Tax order matters and is respected: discount first, then GST, with the breakdown in the details. Loans and interest ask when something is missing instead of guessing.',
    lines: [
      { text: '25000 + 18% gst', result: '29,500', note: 'GST 4,500' },
      { text: '1180 inclusive of 18% gst', result: '1,000' },
      { text: 'emi 5 lakh at 9% for 5 years', result: '10,379.18/month' },
    ],
  },
  {
    title: 'Units, dates, time zones, currencies.',
    caption: 'Live exchange rates show their timestamp. Time zones follow daylight saving for the date you name. Abbreviations like EST are fixed offsets.',
    lines: [
      { text: '100 usd in inr', result: '₹8,400', note: '1 USD = 84 INR' },
      { text: '5 ft 10 in in cm', result: '177.8 cm' },
      { text: 'aaj se 45 din baad', result: 'Mon, 7 Dec 2026' },
      { text: '6pm ist to est', result: '7:30 AM EST' },
    ],
  },
  {
    title: 'Lines remember each other.',
    caption: '"name = value" or "name: value" defines a name for the lines below. "that" and "prev" refer to the nearest result above. Everything on screen is the context; nothing hidden.',
    lines: [
      { text: 'rent = 15000', result: '15,000' },
      { text: 'food = 8000', result: '8,000' },
      { text: 'rent + food', result: '23,000' },
      { text: '10% of that', result: '2,300' },
    ],
  },
  {
    title: 'Facts, offline.',
    caption: 'Astronomy, geography, landmarks and physical constants are built in with their sources, and they can take part in calculations.',
    lines: [
      { text: 'distance from earth to moon', result: '384,400 km', note: 'mean · NASA' },
      { text: 'height of everest in feet', result: '29,031.69 ft' },
      { text: 'distance to moon / speed of light', result: '1.28 s' },
    ],
  },
  {
    title: 'Tax, salary, SIP, FD.',
    caption: 'Indian income tax for FY 2025-26 (new regime unless you say old), CTC to in-hand, SIP and lump-sum growth, FD and RD maturity, loan prepayment, inflation. Every answer lists the assumptions it used.',
    lines: [
      { text: 'income tax on 15 lakh salary', result: '97,500', note: 'new regime' },
      { text: 'ctc 12 lakh in hand', result: '87,800/month' },
      { text: 'sip 5000 at 12% for 10 years', result: '1,161,695.38' },
      { text: 'fd 2 lakh at 7.1% for 3 years', result: '247,015' },
    ],
  },
  {
    title: 'Everyday life.',
    caption: 'Kitchen measures, shoe and shirt sizes, fuel for a trip, the electricity bill, festival dates and birthdays, shift hours, price per kilo, numbers in words, roman, hex and binary.',
    lines: [
      { text: '250 g flour in cups', result: '2.08 cups' },
      { text: 'delhi to jaipur at 15 km/l petrol 105', result: '1,647.1' },
      { text: '1.5 ton ac 8 hours a day for 30 days at 8 per unit', result: '3,456' },
      { text: 'days to diwali 2026', result: '16 days' },
      { text: '12,34,567 in words', result: 'twelve lakh thirty-four thousand…' },
    ],
  },
  {
    title: 'Health and study.',
    caption: 'BMR and daily calories, how much to cut to lose weight, water intake, steps to km, running pace, CBSE grades, the marks you still need, workers-and-days and train problems.',
    lines: [
      { text: 'bmr 70 kg 175 cm 30 male', result: '1,649 kcal/day' },
      { text: '5 km in 28 minutes pace', result: '5:36 min/km' },
      { text: 'marks needed for 85 average with 78, 82, 91', result: '89' },
      { text: '12 workers 8 days, 16 workers how many days', result: '6 days' },
    ],
  },
  {
    title: 'Equations, statistics, ranges.',
    caption: 'Solve for x, get standard deviation and percentiles, or run one question over a range of years. Select several lines and the strip under the editor shows their sum and average.',
    lines: [
      { text: '2x + 5 = 17', result: 'x = 6' },
      { text: 'std of 4, 8, 15, 16', result: '4.9687' },
      { text: 'emi 5 lakh at 9% for 1 to 3 years', result: '1y: 43,725.74 · 2y: 22,842.37 · 3y: 15,899.87' },
    ],
  },
  {
    title: 'When FATAAK does not understand.',
    caption: 'A line it cannot answer gets chips under the editor: click one to use that form. ✎ Teach FATAAK (also in Settings) opens a three-step panel: type the question your way, pick the form FATAAK knows, check both answers match, save. Numbers become blanks, so one lesson covers every amount. Every unanswered question is also kept on your laptop; Settings → Unanswered exports them as a CSV to send to Rahul for the next version.',
    lines: [
      { text: 'mera tax kitna 15 lakh', result: '', note: 'did you mean: income tax on 15 lakh salary' },
      { text: 'teach: mera tax kitna 15 lakh → income tax on 15 lakh salary', result: 'saved' },
      { text: 'mera tax kitna 9 lakh', result: '0', note: 'taught' },
    ],
  },
  {
    title: 'Make it yours.',
    caption: 'The bar at the bottom switches between Moon, Sun and Star. Star turns FATAAK into tinted glass over your desktop; Settings → Appearance picks the tint, the interface font and the editor font. Everything is saved for next time.',
    lines: [
      { text: 'Moon · Sun · Star', result: 'theme' },
      { text: 'Settings → Appearance → Glass tint', result: '● ● ● ● ●' },
      { text: 'Settings → Appearance → fonts', result: 'Inter · Sora · Fira Code …' },
    ],
  },
  {
    title: 'How to ask, and how not to.',
    caption: 'Do: one question per line, say the unit or currency, say which tax or interest. Don\'t: chat, ask opinions, or mix two questions in one line. When FATAAK is not sure, it says so instead of guessing.',
    lines: [
      { text: 'interest on 10000 at 5%', result: 'tenure?', note: 'asks instead of guessing' },
      { text: '100 usd + 50 eur', result: 'mixed currencies', note: 'add "in USD"' },
      { text: 'hello how are you', result: '' },
    ],
  },
  {
    title: 'Keys.',
    caption: 'Alt+Space shows or hides FATAAK from anywhere. Esc hides. Ctrl+Shift+C copies the current result, Ctrl+Alt+C copies everything with answers. The bar at the bottom pins the window on top, turns widget mode on, and switches between the Moon (dark) and Sun (light) themes.',
    lines: [
      { text: 'Alt+Space', result: 'show / hide' },
      { text: 'Esc', result: 'hide' },
      { text: 'Ctrl+Alt+C', result: 'copy all with answers' },
    ],
  },
];

const TYPE_MS = 28;
const RESULT_MS = 350;
const DWELL_MS = 3200;

export function Tutorial({ onDone }: { onDone: () => void }) {
  const [scene, setScene] = useState(0);
  const [typed, setTyped] = useState<{ line: number; chars: number; shown: number }>({ line: 0, chars: 0, shown: 0 });
  const [playing, setPlaying] = useState(true);
  const [progress, setProgress] = useState(0);
  const timer = useRef<number | undefined>(undefined);
  const stateRef = useRef({ scene, typed, playing });
  stateRef.current = { scene, typed, playing };

  // one tick drives typing, result reveal, dwell and the next scene
  useEffect(() => {
    const step = () => {
      const { scene: sc, typed: t, playing: pl } = stateRef.current;
      if (!pl) return;
      const s = SCENES[sc];
      const line = s.lines[t.line];
      if (!line) return;
      if (t.chars < line.text.length) {
        setTyped({ ...t, chars: t.chars + 1 });
        timer.current = window.setTimeout(step, TYPE_MS);
        return;
      }
      if (t.shown <= t.line) {
        setTyped({ ...t, shown: t.line + 1 });
        timer.current = window.setTimeout(step, RESULT_MS);
        return;
      }
      if (t.line + 1 < s.lines.length) {
        setTyped({ line: t.line + 1, chars: 0, shown: t.shown });
        timer.current = window.setTimeout(step, RESULT_MS);
        return;
      }
      timer.current = window.setTimeout(() => {
        const cur = stateRef.current;
        if (!cur.playing) return;
        if (cur.scene + 1 < SCENES.length) {
          setScene(cur.scene + 1);
          setTyped({ line: 0, chars: 0, shown: 0 });
          timer.current = window.setTimeout(step, RESULT_MS);
        } else onDone();
      }, DWELL_MS);
    };
    timer.current = window.setTimeout(step, 600);
    return () => window.clearTimeout(timer.current);
  }, [scene, playing, onDone]);

  useEffect(() => {
    const s = SCENES[scene];
    const totalChars = s.lines.reduce((n, l) => n + l.text.length, 0);
    const done = s.lines.slice(0, typed.line).reduce((n, l) => n + l.text.length, 0) + typed.chars;
    setProgress((scene + done / Math.max(1, totalChars)) / SCENES.length);
  }, [scene, typed]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onDone();
      if (e.key === ' ') {
        e.preventDefault();
        setPlaying((p) => !p);
      }
      if (e.key === 'ArrowRight') go(1);
      if (e.key === 'ArrowLeft') go(-1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const go = (d: number) => {
    const next = Math.min(SCENES.length - 1, Math.max(0, scene + d));
    setScene(next);
    setTyped({ line: 0, chars: 0, shown: 0 });
    setPlaying(true);
  };

  const s = SCENES[scene];
  return (
    <div className="tutorial" role="dialog" aria-label="FATAAK tutorial">
      <div className="tut-card">
        <div className="tut-bar">
          <div className="tut-bar-fill" style={{ width: `${Math.round(progress * 100)}%` }} />
        </div>
        <div className="tut-head">
          <span className="tut-step">
            {scene + 1} / {SCENES.length}
          </span>
          <h2>{s.title}</h2>
        </div>
        <div className="tut-screen">
          {s.lines.map((l, i) => {
            if (i > typed.line) return null;
            const text = i < typed.line ? l.text : l.text.slice(0, typed.chars);
            const show = i < typed.shown;
            return (
              <div className="tut-line" key={`${scene}-${i}`}>
                <span className="tut-text">
                  {text}
                  {i === typed.line && typed.chars < l.text.length && <span className="tut-caret" />}
                </span>
                {show && l.note && <span className="tut-note">{l.note}</span>}
                {show && <span className={`tut-result${l.result ? '' : ' empty'}`}>{l.result}</span>}
              </div>
            );
          })}
        </div>
        <p className="tut-caption">{s.caption}</p>
        <div className="tut-controls">
          <button onClick={() => go(-1)} disabled={scene === 0}>
            ‹ Back
          </button>
          <button onClick={() => setPlaying((p) => !p)}>{playing ? '❚❚ Pause' : '▶ Play'}</button>
          <button onClick={() => (scene + 1 < SCENES.length ? go(1) : onDone())}>{scene + 1 < SCENES.length ? 'Next ›' : 'Start using FATAAK'}</button>
          <button className="tut-skip" onClick={onDone}>
            Skip
          </button>
        </div>
      </div>
    </div>
  );
}
