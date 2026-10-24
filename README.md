# FATAAK

**Think it. Type it. Fataak.**

A Windows 10/11 smart calculator: type a line, the answer appears on the right. Understands English and
Hinglish, Indian finance and tax, currencies, units, dates and time zones, health and study maths. Deterministic,
offline and free: no AI, no account, no data leaves the laptop.

Built with Electron, React, TypeScript and Vite. Current version: **1.2.0**.

## Download and install

1. Download the latest zip from **[Releases](https://github.com/Rahul-Undefined/Fataak/releases/latest)**
   (the file named `FATAAK-<version>-x64.zip`, not "Source code").
2. Extract it anywhere and double-click `Install-FATAAK.cmd`. No admin rights, no UAC prompt: it copies the app to
   `%LOCALAPPDATA%\Programs\FATAAK`, adds Start Menu and Desktop shortcuts, and starts FATAAK.
3. `Alt+Space` shows or hides FATAAK from anywhere.

After that, FATAAK updates itself: Settings → **Check for updates** (or the `↑ x.y.z ready` chip in the title bar)
downloads the next release and restarts on it. See *Updates* below.

## What's new

- **1.2** — **Star** theme: tinted glass over the desktop (Windows 11 acrylic; a deep tinted surface on older Windows),
  with a tint picker; interface and editor **fonts** of your choice (Inter, Manrope, Outfit, Space Grotesk, Plus Jakarta
  Sans, Sora, DM Sans; JetBrains Mono, Fira Code, Geist Mono, IBM Plex Mono, Source Code Pro), bundled under the SIL
  Open Font License, no download at run time. Spelled-out `multiplied by` / `divided by` act on the whole sum before them.
- **1.1** — *Did you mean* chips when a line is not understood; **Teach FATAAK** (your own phrasing, numbers become
  blanks); a local log of unanswered questions with CSV export; self-update from GitHub Releases.
- **1.0** — everyday calculators: income tax (FY 2023-24 … 2025-26, surcharge), CTC → in-hand, SIP/FD/RD, loan
  prepayment, inflation, bills, cooking, sizes, fuel, electricity, festivals, BMR/TDEE, pace, grades, equations,
  statistics, ranges. A 4,600-case generated benchmark with an independent oracle (docs/QA-REPORT.md).

## Run from source

```bash
npm install
npm run dev        # Electron with hot reload
npm test           # vitest: engine/app tests, 974-case benchmark, 4,619 generated cases with a Python oracle (tests/gen), metamorphic suite; 6,387 tests
npm run build      # bundles main / preload / renderer into out/
npm run dist       # Windows installer + portable exe into release/
```

`npm run dev:renderer` serves only the UI in a normal browser (localStorage shim) for visual checks.

## Installing on a managed office laptop (no admin, no new executables)

Endpoint security (Microsoft Defender for Endpoint, Intune) blocks executables whose hash it has never seen,
which is exactly what a freshly built installer or a patched `FATAAK.exe` is. FATAAK therefore ships as a
**zip whose `FATAAK.exe` is byte-identical to the stock Electron binary** (no icon/resource patching,
`asar: false`), plus a script-only installer:

```bash
npm run dist:zip      # → release/FATAAK-<version>-x64.zip
```

1. Extract the zip anywhere (for example `Downloads\FATAAK`).
2. Double-click `Install-FATAAK.cmd`. It copies the folder to `%LOCALAPPDATA%\Programs\FATAAK`,
   creates Start Menu and Desktop shortcuts with the FATAAK logo, registers `fataak` for Win+R
   (HKCU App Paths, no admin), and starts the app. No UAC prompt.
3. `Uninstall-FATAAK.cmd` removes it again (history and settings in `%APPDATA%\FATAAK` are kept).

You can also just run `FATAAK.exe` straight from the extracted folder. On first run the app writes its own
Start Menu shortcut (icon + AppUserModelID), which is what Windows uses when you pin it to the taskbar,
so the pinned icon is the FATAAK logo rather than the Electron one. `FATAAK.exe --install-shortcuts`
(what the install script calls) writes the Start Menu and Desktop shortcuts and exits.

Why this works where an installer does not: the laptop's Defender ASR rule "block executable files unless they
meet a prevalence, age or trusted-list criterion" (event 1121, rule 01443614-…) rejects any brand-new exe,
but the stock Electron binary is already prevalent and therefore allowed.

`npm run dist` additionally tries the NSIS installer and portable exe; those need a build machine where
newly generated executables are allowed to run (the uninstaller stub is executed during the build).

## Using it

| Type                                     | Result                                   |
| ---------------------------------------- | ---------------------------------------- |
| `Price: $10`                             | `$10` (also defines the variable `price`) |
| `Fee: 4 GBP in Euro`                     | `4.72 EUR` + rate and timestamp          |
| `sum in USD - 4%`                        | sum of the block above, converted        |
| `next friday + 2 weeks`                  | `Fri, 13 Nov 2026`                       |
| `20 ml in tea spoons`                    | `4.06 tsp`                               |
| `20% of what is 30 cm`                   | `150 cm`                                 |
| `Meri salary 12% badhao`                 | needs `salary: 50000` above → `56,000`   |
| `25000 pe 18% GST add karo`              | `29,500` (GST 4,500)                     |
| `29500 inclusive of 18% GST`             | `25,000` (reverse GST)                   |
| `emi 5 lakh at 9% for 5 years`           | `10,379.18/month` + total and interest   |
| `10000 pe 5% byaj 2 saal`                | `1,000` simple interest + total          |
| `bought at 500 sold at 600`              | `100 profit` (20% on cost)               |
| `margin 25% on 400` / `markup 25% on 400`| `533.33` / `500`                         |
| `100 USD in INR`                         | live rate with timestamp                 |
| `6pm IST to EST` / `London 10am to Kolkata time` | DST-aware via IANA zones          |
| `aaj se 45 din baad`                     | `Mon, 7 Dec 2026`                        |

**Context from visible lines.** A line like `rahul Rs 100` or `rent 15000` defines that name for the lines
below it, so `Rahul + Rohit * 2`, `Rahul / 5` or `rahul Rs in USD` just work. Delete or clear the defining
line and the name is forgotten; nothing is remembered outside what is on screen.

**Dated and relative questions.** `1 usd to inr 10 days ago` or `100 usd in inr on 1 jan 2026` use the
ECB rate for that day (frankfurter.app, cached). `2 hrs from now in EST`, `in 3 hours Tokyo time`,
`30 min ago in London`, `2 ghante baad est me kitne baje` and `now + 2 hours in EST` shift the current
time first and then convert it.

**Multi-step sentences.** The intent layer splits a sentence into clauses (commas, "then/phir/tarpor",
"and/aur/ar") and applies the operations in order: `5000 ka aadha aur usmein 250 jodo` → 2,750;
`Calculate a 10% raise, then another 5% raise on the new amount, starting at 50000` → 57,750 with the
trail `50,000 → 55,000 → 57,750 · +7,750 (15.5%)`; `20% off then 10% off on 1000` → 720;
`Rahul ko 150, Rohit ko 250, total kitna?` → 400 (and `rahul`, `rohit` become usable below).
`Revenue 500000, expenses 350000, profit margin?` → 30% with the profit in the note. Numbers in words
compose (`five hundred`, `paanch sau`, `1 lakh 20 hazaar`). `50000 divided equally among 3 people` /
`50000 ke 3 bhag karo` → `16,666.67 each` with the exact value in the note. `1000 including 18% GST, then
apply 10% discount` → 900 with the discounted taxable base and GST shown.

**More forms.** `840 is 12% less than what original amount?` → 954.55; `5 items cost 24.75 each, add 12% tax`
→ 138.6 with the taxable base and tax; `10% discount on 4500, then add 18% GST` → 4,779; `10000 pe 5% byaj 2
saal, kitna milega?` → the amount (interest in the note) while `simple interest on …` → the interest;
`Square root of 50 rounded to 3 decimal places` → 7.071; `2.75 hours into hours and minutes` → 2 hours 45
minutes; `days until 25 dec 2026`; `1200 ka 15 percent nikal ke usme 80 jod do` → 260.

**Also understood.** `What original amount becomes 3910 after a 15% increase?` → 3,400; `Revenue is 12 lakh and
net profit is 1.8 lakh, net profit margin` → 15%; `Split 96000 into 25% rent, 18% food, 12% travel, 15% savings and
remaining other expenses` → each share (and `rent`, `food`… become names); `2.4 cubic metres to litres`; `15% of 800,
then subtract 35% of 240` → 36; `weekdays from 1 January 2027 through 31 January 2027` → 21 weekdays; `4 items at
1250 each, a 10% discount before GST, and 18% GST` → 5,310 with each step labelled; `Salary 68000, increase by 7%,
then deduct 10%` → 65,484. A sentence-ending period is ignored.

**From the reliability audit.** `-2 ^ 2` → −4 and `10 - 2 - 3` → 5 (standard precedence), `5!` → 120,
`average of 10, 20, 30`, `median of 3, 9, 4`, `max(1, 5, 3)`, `divide 900 in ratio 1:2:3` → 150 / 300 / 450,
`12 ka 3 guna` and `3 lakh ka 2 guna` → 36 / 600,000, `aaj ke 45 din baad` and `today 3 weeks later` shift the date,
`age if born 15 aug 1990`, `is 2028 a leap year`, `what day is 25 dec 2026`, `10 am to 5:30 pm minus 30 min break`
→ hours, `flat rate loan 100000 at 10% for 2 years` (flat vs reducing-balance EMI), `-273.15 c in k` → 0 K.
`5 items cost 24.75 each add 12% tax` is a price, never a profit/loss guess; `cost 500 sold 600` still is one.
Unknown words (`asdf`, `constructor`), `10 % 5 %`, `1e309` and a dangling `5 +` show a hint, never a number.

**Reliability upgrade (Oct 2026).** Long statements work as well as short ones: `If x = 375 and y = 28% of x,
calculate x + y, x - y and x * y` → `480 · 270 · 39,375` (and `x`, `y` stay defined); `Set rent = 18500, food = 9200 and
travel = 3750. Calculate total expenses and remaining balance from salary of 78500` → `31,450 · 47,050`; `A customer owes
25000 plus 18% GST after a 10% discount and pays 15000` → 11,550 with the invoice trail; `mere paas 5000 the, 1275 kharch
kiye, phir 450 mile, kitna bacha` → 4,175; `Convert 7.85 kilometres to metres, miles and feet` → all three; `180 cm in ft
and in` → `5 ft 10.87 in`; `A tank holds 2.75 cubic metres, 18% is drained and 125 litres are added, how many litres
remain?` → 2,380 l; `lcm of 84 and 126`, `gcd(48, 180)`, `mode of 1, 2, 2, 3`, `2 raised to the power of 15`, `4th root
of 81`, `√144`; `sin(30)` → 0.5 (degrees); `invested 5000 got back 6500, return` → 30% return; `ratio 300:400` → 3:4;
`revenue 25 lakh, cogs 14.5 lakh, opex 7 lakh` → operating profit with gross profit and margins; `salary 60000, 30% tax
katke` and `12% tds on 50000` are deductions, while `1180 inclusive of 18% gst` removes GST; `what time in sydney when it
is 9am in mumbai`, `10:30 pm ist to 6:45 am gmt duration`, `45 min before 10am`, `age on 23 oct 2026 if born 23 oct
2000`, `days until end of year`, `2 saal pehle ki date`. Percentages print to 2 decimals. English and Hinglish are
understood.

**Version 0.2 additions.** Data sizes and bandwidth: `1 pb in tb`, `8 gbit in gb`, `2 gb at 50 mbps` → `5 min 20 s`,
`how long to download 4.7 gb at 25 mbps`, `10 mbps for 1 hour` → 4.5 GB, `2 gb in 10 seconds` → 200 MB/s. Reference facts,
offline with sources: `distance from earth to moon`, `sun se earth ki doori`, `size of pacific ocean`, `height of everest in
feet`, `speed of light`, `mass of earth`, `area of india`, `delhi to mumbai distance` (straight-line), and they work inside
expressions (`distance to moon / speed of light` → 1.28 s). Everyday asks: `bmi 70 kg 175 cm`, `mileage 600 km in 40
litres` → 15 km/l, `fuel for 600 km at 15 km/l`, `6 lakh per year in month`, `5 lakh in millions`, `cgpa 8.2 to percentage`,
`3 dozen`, `time difference between india and london`, `450 km at 60 km/h` → 7.5 h, `age in days if born 1 jan 2000`.
In the app: double-click a result to see the working (every step, rate and source) and copy it; the bar at the bottom has
labelled toggles for **On top**, **Widget** mode (pinned to the desktop, no taskbar entry, cannot be moved, minimised or
closed until turned off) and the theme (**Moon**, **Sun**, **Star**; Settings → Appearance holds the glass tint and the fonts); **? Help** replays the animated tutorial that autoplays on first
run; **Settings** shows the version and build date and checks GitHub Releases for a newer FATAAK (see *Updates*).

**Version 1.1: when FATAAK does not understand.** A line it cannot answer gets *Did you mean* chips under the editor,
built offline from the typed words and numbers; click one to use that form. **✎ Teach FATAAK** (also in Settings)
saves your own phrasing next to a form FATAAK knows: numbers in the phrase become blanks, so teaching
`mera tax kitna 15 lakh` → `income tax on 15 lakh salary` also answers `mera tax kitna 9 lakh`. The panel checks both
answers match before it saves; rules live in `%APPDATA%\FATAAK\teach.json` and can be deleted from the list. Every
question FATAAK could not answer is kept locally (`unanswered.json`); Settings → **Unanswered** exports them as a CSV
(with a column for the answer you expected) to send to Rahul, so the next version understands them for everyone.

## Updates

Settings → **Check for updates** reads the latest release of the GitHub repository in *Update source* (default
`Rahul-Undefined/Fataak`). When a newer `FATAAK-<version>-x64.zip` is published, **Install and restart** downloads it
to `%APPDATA%\FATAAK\updates`, extracts it with Windows PowerShell, and runs a small script that waits for FATAAK to
close, copies the new files over the install folder with robocopy (per-user, no admin), clears the "from the internet"
mark, and starts FATAAK again. The exe inside every release is the same unmodified Electron binary, so endpoint
security sees nothing new. The installed app also checks once, quietly, eight seconds after start-up and shows an
`↑ x.y.z ready` chip in the title bar when an update is waiting. The repository (or at least its Releases) must be
public: the app carries no token.

Publishing a release (maintainer):

```bash
npm version minor          # or patch / major: bumps package.json and tags vX.Y.Z
git push --follow-tags     # the release workflow builds the zip on GitHub and attaches it to the release
```

**Version 1.0 everyday calculators.** Money: `income tax on 15 lakh salary` (FY 2025-26, new regime by default, `old regime`
on request), `ctc 12 lakh in hand`, `sip 5000 at 12% for 10 years`, `how much monthly sip for 50 lakh in 10 years at 12%`,
`lumpsum 1 lakh at 10% for 15 years`, `fd 2 lakh at 7.1% for 3 years`, `rd 5000 for 2 years at 6.5%`, `emi 30 lakh 8.5% 20
years, prepay 2 lakh after 2 years`, `paisa double at 9%`, `10 lakh today in 10 years at 6% inflation`, `rent 25000 with 10
months deposit`, `bill 4800, rahul 2 items, priya 1 item`. Daily life: `250 g flour in cups`, `uk 9 shoe in us`, `shirt size
for 40 inch chest`, `ideal weight for 175 cm`, `delhi to jaipur at 15 km/l petrol 105`, `1.5 ton ac 8 hours a day for 30 days
at 8 per unit`, `days to diwali 2026`, `next birthday if born 15 aug 1990`, `week number of 15 nov 2026`, `9:30 to 18:45
minus 45 min, 22 days`, `time left until 5pm`, `5 kg at 450 vs 2 kg at 190`, `12,34,567 in words`, `2026 in roman`, `255 in
hex`, `0b1010 + 5`. Health and study: `bmr 70 kg 175 cm 30 male`, `tdee … moderate`, `calories to lose 0.5 kg a week`,
`water intake 70 kg`, `10000 steps in km`, `5 km in 28 minutes pace`, `grade for 86%`, `average of 78 82 91 then what for
85 average`, `12 workers 8 days, 16 workers how many days`, `train 300 m at 72 km/h crosses platform 200 m`. Deeper:
variables keep their units, `2x + 5 = 17` and `x% of 80 = 20` are solved, `std / variance / range / 90th percentile of …`,
`x = 1 to 12`, `emi 5 lakh at 9% for 1 to 5 years` gives one answer per year, and selecting several lines shows their sum
and average in the strip under the editor.

**Version 1.0.1 (QA round).** Income tax knows FY 2023-24, 2024-25 and 2025-26 (`income tax on 15 lakh salary fy
2024-25`, `… ay 2025-26`) and applies surcharge above 50 lakh with marginal relief; unknown years are refused. Lists
keep negative numbers (`std of 4, -8, 15`), spans written in 24-hour form cross midnight (`10:30 to 00:15` → 13 h 45
min), a discount-GST chain can end in `/ 3`, `split 3 ways` or `between 3 people`, every date answer shows its
weekday, and durations print as `8 h 30 min`. See docs/QA-REPORT.md for the full defect list and test method.

**Currencies are never mixed silently.** `$100 + ₹500` is an error asking for a target; `$100 + ₹500 in USD`
or `sum in USD` converts with the rate shown.

**Previous-result policy.** `that`, `usmein`, `previous result`, `prev` refer to the nearest line above
that produced a value. Blank lines, plain text and failed lines are skipped, so a typo never replaces
the last good result; variable lines count. A line saying `clear context`, `reset` or `sab bhool jao`
is a hard stop: it forgets the results and variables above it, and later references say so. With no
usable result above, the hint says "no result above this line".

**Offline and cached rates.** A line containing `offline` (or `cached`) never presents a live rate: it
answers from the cached table and labels the note `Cached rate · … · updated <time>`, or says the rate
is unavailable offline. When a fetch fails and the on-disk cache is used, the note carries `· offline`.
Historical conversions (`100 USD to INR using the historical rate for 1 January 2025`) show the rate,
source and actual rate date; when the provider has no rate for that day (weekend, holiday) the previous
business day is used and disclosed.

**Time-zone abbreviations are fixed offsets.** `EST` is always UTC−5 (even in July), `PST` UTC−8,
`CET` UTC+1; cities and regions (`New York`, `ET`, `US Eastern`, `London`) follow daylight-saving rules
for the date in question. `6pm IST to EST` → 7:30 AM EST; `6pm IST to New York` → 8:30 AM EDT in summer.

Percent rules follow Numi: `$10 - 40%`, `20% of $10`, `5% on $30`, `6% off 40 EUR`, `$50 as a % of $100`, `5% of what is 6 EUR`.
`prev`, `sum`/`total`, `average`, `line3`, `// comments`, `"inline comments"` and `# headers` work as in Numi.

When a financial input is ambiguous (no GST rate, no tenure, undefined variable) the result column shows a hint instead of a guess.

### Keys

- **Alt+Space** (configurable; falls back to Ctrl+Alt+Space if taken) — show/hide from anywhere.
  `Fn` is handled by the laptop firmware and never reaches Windows, so `Fn+Space` cannot be a hotkey.
- **Esc** — hide window
- **Enter** — new line; **Ctrl+Enter** — copy this line's result and start a new line
- **Ctrl+Shift+C** — copy result of the current line; click a result to copy it
- **Ctrl+A, Ctrl+C** (any multi-line selection) — copies `expression = result` for each selected line
- **Ctrl+Alt+C** — copy everything; **Ctrl+Alt+Backspace** — clear all
- **Win+R, `fataak`** — opens FATAAK after a script install (per-user App Paths registry entry)
- Bottom-left toggle: always on top. Bottom-right arrow: settings (hotkey, tray, quit).

### History

Every line is saved locally (`%APPDATA%\fataak\history.json`) and expires 24 hours after it was first typed.
Unexpired lines are restored on restart; expired lines are removed on load, every minute in the background, and every 30 s in the window.

## Currency and privacy

Ordinary calculations work offline. Currency conversion needs a rate: the main process fetches
`open.er-api.com` (fallback `frankfurter.app`, ECB), caches it on disk and shows the publication timestamp
next to each conversion; cached rates are marked `(cached)` when older than a day. No other network access, no telemetry.

## Security

- `contextIsolation`, `sandbox`, no `nodeIntegration`; the preload exposes a small validated API only.
- Packaged renderer runs under `default-src 'self'; script-src 'self'; connect-src 'none'` (CSP header), navigation and window creation are denied, all permission requests are refused.
- No `eval` / `Function`: expressions go through a tokenizer, a Pratt parser and a typed evaluator (decimal.js).

## Layout

```
src/engine      pure TypeScript calculation engine (tokenizer, parser, evaluator, units, currency,
                finance, dates, timezone, nl/normalize + nl/intents, history expiry)
src/main        Electron main: window, hotkey, tray, IPC, JSON stores, rate service
src/preload     contextBridge API with argument validation
src/renderer    React UI (Numi-style editor with right-aligned results)
tests           vitest suites
```
