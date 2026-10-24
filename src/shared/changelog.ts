/** Release notes shown in the app after an update (newest first). Keep each line short and user-facing. */
export interface ReleaseNote {
  version: string;
  date: string;
  added?: string[];
  changed?: string[];
  fixed?: string[];
}

export const CHANGELOG: ReleaseNote[] = [
  {
    version: '1.3.0',
    date: '24 Oct 2026',
    added: ['Quick launcher (Settings): the hotkey opens a small glass bar with a living orb on any screen; type one line, Enter copies the answer, Ctrl+Enter brings it into the window', 'Start with Windows (Settings): FATAAK waits in the tray from login', 'Pinned values: names that never expire (Settings → Pinned, or hover a definition and click 📌); every line can use them', 'Fixed answers: units of things ("unit of electricity"), full forms ("emi full form"), Indian finance constants ("80c limit", "gst rates", "tds on fd"), calendar facts, tola and quintal', 'Step by step for dates, conversions, inflation, prepayment, proportion, in-hand salary, health and time spans', 'Tutorial scenes on building on the line above and tips & tricks'],
  },
  {
    version: '1.2.4',
    date: '24 Oct 2026',
    added: ['Step by step: double-click a result and the card shows every operation in order (10 + 5 = 15, 15 × 0 = 0), slab-by-slab income tax, and the formulas with numbers for EMI, interest, SIP, lump sum, FD, RD and GST'],
    changed: ['The strip under the editor is gone; selecting several lines shows their sum and average in a small pill instead'],
  },
  {
    version: '1.2.3',
    date: '24 Oct 2026',
    changed: ['The strip under the editor appears only when a line has a working to show; click it to open every step', 'Scrollbars are thin and follow the theme', 'Softer, slightly longer motion curves', 'This panel appears once per new version and then stays away'],
  },
  {
    version: '1.2.2',
    date: '24 Oct 2026',
    fixed: ['Narrow windows: the bottom bar keeps its icons and drops the words, the status strip trims with an ellipsis, and the placeholder shortens instead of breaking mid-word'],
  },
  {
    version: '1.2.1',
    date: '24 Oct 2026',
    added: ['This panel: what changed, after every update (also under Settings → What’s new)', 'A note that FATAAK is still learning and can make mistakes'],
    changed: ['Settings closes when you click anywhere outside it', 'Results and panels fade in softly instead of popping', 'The version moved from the title bar into Settings; the title bar only shows a chip when an update is available', 'Star theme: the custom colour picker is gone, the swatches stay', 'Settings is shorter: the keyboard hints now live in the tutorial'],
    fixed: ['Unanswered questions are now recorded even while the cursor stays on that line (after five idle seconds)'],
  },
  {
    version: '1.2.0',
    date: '24 Oct 2026',
    added: ['Star theme: tinted glass over the desktop (Windows 11 acrylic), with a tint picker under Settings → Appearance', 'Fonts of your choice for the interface and the editor: Inter, Manrope, Outfit, Space Grotesk, Plus Jakarta Sans, Sora, DM Sans; JetBrains Mono, Fira Code, Geist Mono, IBM Plex Mono, Source Code Pro', 'Tutorial scene for themes, tint and fonts'],
    fixed: ['"10 + 5 multiplied by 0" is the whole sum times 0; "10 + 5 * 0" keeps ordinary precedence. The note says which reading was used'],
  },
  {
    version: '1.1.4',
    date: '24 Oct 2026',
    changed: ['Panels are written in English only', 'README refreshed with download and update instructions'],
  },
  {
    version: '1.1.3',
    date: '24 Oct 2026',
    fixed: ['Updates apply without a console window, report their outcome after the restart, and clean up after themselves', 'Scripts left behind by the 1.1.1 updater are ended automatically'],
  },
  {
    version: '1.1.1',
    date: '24 Oct 2026',
    added: ['Self-update: Settings → Check for updates installs the next release from GitHub and restarts'],
  },
  {
    version: '1.1.0',
    date: '24 Oct 2026',
    added: ['Did you mean: chips under a line FATAAK did not understand', 'Teach FATAAK: your own phrasing, numbers become blanks', 'Unanswered questions kept locally, exported as CSV to send for the next version'],
  },
  {
    version: '1.0.1',
    date: '24 Oct 2026',
    fixed: ['Negative numbers in lists', 'Time spans written in 24-hour form across midnight', 'Income tax surcharge above 50 lakh; FY 2023-24 and 2024-25 slabs', 'Impossible dates like 31 Feb are refused', 'Discount–GST chains ending in "/ 3" or "split 3 ways"', 'Every date answer shows its weekday; durations print as "8 h 30 min"'],
  },
  {
    version: '1.0.0',
    date: '24 Oct 2026',
    added: ['Income tax, CTC to in-hand, SIP, FD, RD, prepayment, inflation, bills', 'Cooking measures, sizes, fuel, electricity, festivals, birthdays, shift hours', 'BMR, TDEE, pace, grades, marks needed, proportion, train problems', 'Equations in x, statistics, ranges, selection totals'],
  },
];

export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((x) => parseInt(x, 10) || 0);
  const pb = b.split('.').map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

export function notesSince(fromVersion: string | undefined, toVersion: string): ReleaseNote[] {
  const cmp = compareVersions;
  return CHANGELOG.filter((n) => cmp(n.version, toVersion) <= 0 && (!fromVersion || cmp(n.version, fromVersion) > 0));
}
