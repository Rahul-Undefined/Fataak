# FATAAK

**Think it. Type it. Fataak.**

A Windows 10/11 smart calculator in the spirit of Numi: type a line, the answer appears on the right.
Understands English, Hinglish and Bengalish, finance formulas, currencies, units, dates and time zones.

Built with Electron, React, TypeScript and Vite.

## Run from source

```bash
npm install
npm run dev        # Electron with hot reload
npm test           # vitest: engine, finance, multilingual, time zones, history, app behaviour
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
| `next friday + 2 weeks`                  | `13 Nov 2026`                            |
| `20 ml in tea spoons`                    | `4.06 tsp`                               |
| `20% of what is 30 cm`                   | `150 cm`                                 |
| `Meri salary 12% badhao`                 | needs `salary: 50000` above → `56,000`   |
| `Amar salary 12% barale koto hobe?`      | same                                     |
| `25000 pe 18% GST add karo`              | `29,500` (GST 4,500)                     |
| `29500 inclusive of 18% GST`             | `25,000` (reverse GST)                   |
| `emi 5 lakh at 9% for 5 years`           | `10,379.18/month` + total and interest   |
| `10000 pe 5% byaj 2 saal`                | `1,000` simple interest + total          |
| `bought at 500 sold at 600`              | `100 profit` (20% on cost)               |
| `margin 25% on 400` / `markup 25% on 400`| `533.33` / `500`                         |
| `100 USD in INR`                         | live rate with timestamp                 |
| `6pm IST to EST` / `London 10am to Kolkata time` | DST-aware via IANA zones          |
| `6pm IST theke EST e convert koro`       | same                                     |
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
compose (`five hundred`, `paanch sau`, `1 lakh 20 hazaar`). `that`/`usmein`/`previous result` refer to the
line immediately above; if that line has no result the calculator says so instead of guessing.

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
