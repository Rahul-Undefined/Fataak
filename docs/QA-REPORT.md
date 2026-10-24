# FATAAK — extreme QA, adversarial testing and self-healing report

Date: 24 Oct 2026. Version under test: 1.0.0 → fixes shipped as 1.0.1. Scope: the whole engine (`src/engine`, `src/engine/nl`,
`src/engine/extras.ts`) through its real entry point `evaluateDocument`, i.e. parsing, intent routing, calculation and the
rendered display/note text. The Electron shell and React UI were not changed.

## 1. Feature inventory (phase 1)

| Status | Features |
| --- | --- |
| Fully implemented | arithmetic with precedence, powers, roots, functions, factorial, mod, scientific notation, Indian/Western number words and scales; percent forms (of/off/on/as % of/of what/points/change/reverse); GST add and reverse, CGST/SGST, discounts and successive discounts, chains (discount → GST → tip → split); profit/loss, margin ↔ markup; EMI (reducing and flat), prepayment, simple and compound interest (yearly/half-yearly/quarterly/monthly/daily), SIP, goal SIP, lump sum, FD, RD, rule of 72, inflation, rent, bill shares, equal and unequal splits, price-per-unit comparison; income tax FY 2023-24 / 2024-25 / 2025-26 new regime, old regime, 87A rebate with marginal relief, surcharge with marginal relief, cess, CTC → in-hand; units (length, mass, volume, area, temperature, time, data incl. binary units, bandwidth, speed, fuel economy, angle) with dimensional arithmetic (speed × time, distance ÷ speed, length × length × length, data ÷ rate, fuel); dates (offsets, month-end clamping, leap years, weekdays, week numbers, ages, festivals 2026–2028, birthdays), time spans across midnight with breaks, time-zone conversion with DST; lists (sum/avg/median/mode/min/max/lcm/gcd), population std/variance/range, nearest-rank percentile; linear equations in x; direct and inverse proportion, train-platform; variables with units, `prev`/`that`; BMI, BMR/TDEE, calorie deficit, water, steps, pace; grades, marks needed, CGPA; cooking cups/grams, shoe/shirt sizes, ideal weight; fuel cost, electricity; number ↔ words, roman, hex/binary/octal; currencies (live/cached/historical). |
| Partially implemented (by design) | `10 % 3` is percent-of (use `mod`); `a hours b minutes` literals resolve to the smaller unit; 10/11/12 o'clock without am/pm in a span are read on a 12-hour clock; festival dates only for 2026–2028; historical currency only from the ECB set. |
| Unsupported (explicit error) | non-linear equations, simultaneous equations, income tax for years other than FY 2023-24 … 2025-26, public holidays, timers/alarms, any chat/opinion question. |
| Implemented but previously untested | surcharge, other financial years, lists with negative numbers, spans written in 24-hour form, invalid textual dates, parenthesised chains, chains ending in a divisor, multi-word conversion targets, cup pluralisation, `very active` TDEE. All are now covered by `tests/regression5.test.ts` and the generated benchmark. |

Baseline before this mission: `npx tsc --noEmit` clean; `npx vitest run` → 18 files, 1,685 tests, all passing; `release/FATAAK-1.0.0-x64.zip` built.

## 2. Test generation and oracle (phases 2–3)

`tests/gen/generate.py` is a seeded generator (seed 20261024) whose expected values are computed by Python only:
`decimal` with HALF_UP for money, `fractions.Fraction` for exact expression trees, `datetime` for calendars, and
independent re-implementations of EMI, SIP (annuity due), FD (quarterly), RD (bank method), compound interest,
income tax slabs/rebate/surcharge, Mifflin-St Jeor, Devine, nearest-rank percentiles, population variance,
unit factors, ISO weeks. It writes `tests/gen/cases.json` (4,619 cases, 55 sub-categories). Expectation kinds:
`num` (first number in the display within a stated tolerance, plus a unit suffix), `exact`, `contains` (display and
note), `any`/`anynum` (documented alternative readings), `error` (must be a clarification, never a number).

`tests/generated.test.ts` runs every case through `evaluateDocument` and writes `tests/gen/results.json`
(id, category, input, expected, actual, pass, error category) and `tests/gen/failures.txt`.

## 3. Results (phases 4–7)

Generated benchmark, baseline → final:

| Run | Cases | Passed | Failed |
| --- | ---: | ---: | ---: |
| first run against 1.0.0 (oracle v1) | 4,569 | 3,476 | 1,093 |
| after oracle corrections only (no engine change)* | 4,589 | ≈ 4,250 | ≈ 340 |
| final (engine fixed, oracle v2) | 4,619 | 4,619 | 0 |

\* 11 of the first-run failure patterns were the oracle's own mistakes (expression tree parentheses, `a + b − 2b + b`,
hand-computed income tax and std figures, percent-change sign convention, Devine below 152 cm, "weekdays between"
being inclusive by documented design, `**` and unary `+` being valid). They were corrected to independently
verified values; no expectation was ever changed to match an engine output.

Final accuracy by domain:

| Domain | Cases | Passed | Accuracy |
| --- | ---: | ---: | ---: |
| Arithmetic and expression parsing | 306 | 306 | 100% |
| Indian finance and taxation | 1,636 | 1,636 | 100% |
| Dates, times and calendars | 569 | 569 | 100% |
| Units and conversions | 332 | 332 | 100% |
| Statistics, equations, proportion, variables | 824 | 824 | 100% |
| Health, study and everyday utilities | 413 | 413 | 100% |
| Multi-step natural-language problems | 480 | 480 | 100% |
| Safety: malformed / unsupported / casing and spacing variants | 59 | 59 | 100% |

Gates: deterministic arithmetic 100%; core regression suite 100%; supported-feature benchmark 100% (target ≥ 99%);
unsupported/malformed inputs 100% clarification-or-error (59 safety cases + 2,300 fuzz lines); multi-output tests
(prepayment notes, interest + total, shares) 100%; no open critical or high calculation defect; no regression in
previously passing tests except 54 expectations deliberately updated for the two display conventions below.

Metamorphic and fuzz suite (`tests/metamorphic.test.ts`, 22 properties, seeded): commutativity and reordering,
`+p% −p% ≠ original`, 300 unit round trips to 1e-9, temperature trips, EMI schedule reconciliation, GST add/remove
inverse, bill/ratio/equal-split reconciliation, SIP linearity and goal inversion, variance = mean squared deviation,
shift invariance of variance/std/range, list order invariance with negatives, equation solutions satisfy the
equation (using the unrounded stored value), date add/subtract inverses, span + reverse span = 24 h, 2,000 random
token soups never crash, 300 letters-only lines never yield a number, casing/whitespace invariance.

## 4. Defects found and root causes

| # | Defect (input → wrong output) | Root cause | Fix |
| --- | --- | --- | --- |
| 1 | `range of 97 67 39 -5 97` → 58; `std of 4, -8, 15` → 5.5 (negative members silently dropped); `average of 172 117 -15 …` → error | numbers were tagged by a regex without a sign, and `- 5` after a separator was read as subtraction and discarded by the list filter | in list sentences a minus directly before a number is its sign (normalize); number tags accept a sign |
| 2 | `10:30 to 00:15` → 1 h 45 min; `16:45 to 10:30` → 5 h 45 min | the "end before start means afternoon" lift (for `10 baje se 5 baje tak`) was applied to times written unambiguously in 24-hour form | the lift applies only when neither end is explicit (am/pm, leading zero, hour ≥ 13) |
| 3 | income above 50 lakh: no surcharge (`income tax on 60 lakh` → 1,154,400 instead of 1,578,720) | surcharge bands never implemented | 10/15/25% bands (old regime 37% above 5 crore) with marginal relief, shown in the note |
| 4 | `income tax on 15 lakh salary fy 2024-25` → FY 2025-26 figure | one year's slabs were hard-coded as universal | FY 2023-24 and 2024-25 tables added; `fy`/`ay`/"financial year" parsed; unknown years error |
| 5 | `tax on salary of 1500000` → no standard deduction | the phrase "tax on salary" mapped to the tax trigger and swallowed the word *salary* | phrase maps to "itax salary" |
| 6 | `31 feb 2026 + 1 day` → "28 days" | an invalid day-month pair fell through and "feb 2026" was read as a month on its own | impossible textual dates throw with the month's length in the hint |
| 7 | `6196 - 10% + 18% gst / 3` → 5,576.4 (divisor dropped); `(…) / 3` → 3.186; `… split 3 ways` → reverse-GST number | the clause chain had no notion of a trailing divisor or of outer parentheses | trailing `/ N`, `divided by N`, `split N ways`, `between N people` divide the chain's result; one outer pair of parentheses is stripped |
| 8 | `24425 ka 10% nikal ke 18% gst laga ke total` → GST on the full amount (first step dropped); `… me se 10% nikal ke …` → reverse GST | "nikal ke"/"laga ke" were mapped to a generic verb that became "of" | "nikal ke / laga ke" are step markers; "me se P% nikal ke" is "− P% then"; "total me add" is "that add" |
| 9 | `mere paas 25551 the, 180 kharch kiye, 626 aur mile` → asks spent or received | "aur mile" (got more) not recognised | mapped to received |
| 10 | `10 lakh today in 10 years` → a date | the amount was discarded and "today in 10 years" taken as a date offset | asks for the inflation rate |
| 11 | `tdee … very active` → ×1.725 | activity levels searched in an order where "active" matched before "very" | "very" checked first |
| 12 | `cgpa 8.5 in percentage` → 80.8% | pre-pass rounded to one decimal | two decimals |
| 13 | `684.64 kb in mb` → 684.64 KB | the "readable data unit" display rule overrode an explicit target | conversions carry `exactUnit`; the display rule skips them |
| 14 | `convert 792 ft to nautical mile` → miles; `convert 0.5 ml to fl oz` → error | the convert intent only considered single-word targets | multi-word units are matched first |
| 15 | `72 km/h for 0.5 hours` → error; `2 m * 3 m * 4 m` → error; `90 km at 90 km/h` → 60 min | no "speed for time" rewrite; no area × length rule; 1/3.6 representation error at exactly 3600 s | added rewrite and rule; seconds rounded to 6 dp before unit choice |
| 16 | `shoe size 9` → US 10 | UK assumed when no system was named | asks UK, US or EU |
| 17 | `500 ml in cups` → "2.11 cup" | unit symbol singular | pluralised |
| 18 | dates from arithmetic showed no weekday (`today + 45 days` → "7 Dec 2026") while anchors did (`aaj se 45 din baad` → "Mon, 7 Dec 2026") | two date formatters | every date result shows the weekday |
| 19 | spans printed "8 hours 30 minutes" while every other duration printed "8 h 30 min" | two duration formats | spans print h / min |

Items 18 and 19 are display conventions, not calculation errors; the 54 affected expectations in the existing
suites were updated (weekday computed independently in the patch script).

## 5. Files modified

| File | Reason |
| --- | --- |
| `src/engine/nl/normalize.ts` | negative list members, FY/AY tokens, speed-for-time rewrite, "me se … nikal ke", "nikal ke"/"laga ke" as steps, "total me add", "aur mile", "tax on salary", cgpa two decimals, "nikal" compute regex no longer eats "ke" |
| `src/engine/nl/intents.ts` | signed number tags, explicit 24-hour spans, h/min span display, trailing divisor and outer parentheses for chains ("each" kept), multi-word convert targets |
| `src/engine/extras.ts` | income tax by financial year, surcharge with marginal relief, year/surcharge in the note, two-year guard, "very active", shoe-size system required, inflation-rate guard |
| `src/engine/evaluator.ts` | area × length = volume, exact-hour rounding, `exactUnit` on conversions |
| `src/engine/format.ts` | weekday on every date, `exactUnit` respected, "cups" |
| `src/engine/dates.ts` | invalid textual dates throw |
| `src/engine/types.ts` | `exactUnit` flag |
| `tests/audit.test.ts`, `benchmark.test.ts`, `context.test.ts`, `finance.test.ts`, `paraphrase.test.ts`, `engine-units.test.ts` | updated to the weekday/h-min conventions; `31 feb 2026` now expected to throw |
| `package.json` | version 1.0.1 |

Regression tests added: `tests/regression5.test.ts` (44 cases, one per defect pattern above, each failing on 1.0.0),
`tests/generated.test.ts` + `tests/gen/` (4,619 generated cases, oracle, results), `tests/metamorphic.test.ts` (22 properties).

## 6. Commands executed (final run, after the last code change)

```
python -I tests/gen/generate.py        # 4619 cases
npx tsc --noEmit -p tsconfig.json      # clean
npx vitest run                         # see the counts in README.md "npm test" and AUDIT-REPORT.md
npx electron-vite build && npx electron-builder --win zip --config electron-builder.yml
```

## 7. Remaining limitations and unsupported inputs

- Income tax: slabs for FY 2023-24, 2024-25 and 2025-26 only; no deductions beyond the standard deduction (80C, HRA,
  NPS are not modelled); surcharge thresholds use total income after the standard deduction; the 25% cap in the new
  regime and 37% old-regime band above 5 crore follow the Finance Act 2023 wording and should be verified against the
  current circular before relying on them for filings.
- In-hand assumptions (basic 50%, PF 12% both sides, professional tax 2,400) are stated in every note; actual payslips differ.
- Festival dates (2026–2028) follow the Indian national calendar and regional variations are not modelled.
- Time-zone abbreviations are fixed offsets by design (EST is always UTC−5); city names follow DST.
- `10 % 3` is percent-of; `a hours b minutes` literals resolve to minutes; "weekdays between" counts both ends.
- A span whose two ends are 10, 11 or 12 o'clock without am/pm is read on a 12-hour clock (`12:15 to 11:15` = 11 h).
- Non-linear or multi-variable equations, holidays, timers and reminders are reported as unsupported.
- Live currency needs the network; offline answers are labelled with the cached rate's date.
