# FATAAK reliability audit — report

Date: 23 Oct 2026. Scope: the whole calculation engine (`src/engine`), the natural-language layer
(`src/engine/nl`), finance, units, dates, time zones, currency, and the test suite. UI and app
features were not changed.

## Verification

```
npx tsc --noEmit -p tsconfig.json   # clean
npx vitest run                      # 15 files, 552 tests, 552 passed, 0 failed
```

| Suite               | Tests | What it covers                                                        |
| ------------------- | ----: | --------------------------------------------------------------------- |
| audit               |   108 | regressions found by the audit matrix (~430 inputs run by hand)       |
| paraphrase          |   111 | same question in English / Hinglish must give one answer  |
| engine-units        |    33 | pure functions: finance, units, dates, formatting, rounding           |
| properties          |    12 | seeded identities: reverse %, GST add/remove, margin↔markup, EMI sums |
| regression 1–4      |   197 | the four earlier review rounds                                        |
| multilingual        |    41 | normalisation and intent detection                                    |
| arithmetic/finance  |    21 | integration from raw input to displayed text                          |
| context/history/app |    20 | previous-result policy, 24-hour history, app storage                  |
| timezone            |     9 | IANA zones, fixed-offset abbreviations, DST                           |

## Root causes found and fixed

1. **Precedence and unary minus.** `-2 ^ 2` gave 4; the unary branch bound tighter than `^`.
   Unary now wraps the power branch. `10 - 2 - 3` parsed as a date (10-2-3) because the date
   literal ignored spacing; numeric dates now require contiguous tokens.
2. **Number-word composition.** A numeral followed by a spelled number ("5 hundred rupees") fused
   in surprising ways; a numeral and a spelled word now only join through a scale word, and the
   loop can no longer re-enter itself (the earlier "split 50000 three ways" → 50,003 bug).
3. **Conflicting phrase mappings.** `reverse`→remove, `baje`→time, `ta`→items, `kar`→gst,
   `jan`/`log`→people, `weekday`→weekdays and `grow`→increase each hijacked unrelated sentences.
   Removed; the dictionary is longest-match and every entry is single-purpose.
4. **Profit/loss guessing.** With only the word "cost" and two numbers the intent paired them as
   cost and selling price (`5 items cost 24.75 each add 12% tax` → "19.75 loss"). Profit/loss now
   requires a selling-price or profit/loss word; a bare "cost" is a unit price.
5. **Anchored offsets.** `aaj ke 45 din baad` produced two dates (today, today+45) and reported
   the span between them. An offset immediately after today/tomorrow/yesterday now shifts that date.
6. **Hindi multiplication order.** `12 ka 3 guna` only matched plain digits; a Python patch
   had also corrupted the regex with a literal backspace byte. Rewritten to accept scale words
   (`3 lakh ka 2 guna` → 600,000) and checked byte-for-byte.
7. **Mixed currencies.** `$100 + ₹500` silently used one currency. Adding money in different
   currencies is now a data error unless a target (`in USD`) is named; the error kind is never
   re-read as prose by the intent layer.
8. **Prototype keys.** `constructor` as input hung the weekday loop (`in` on plain objects).
   Every dictionary lookup goes through `own()`, and loops have hard bounds.
9. **EMI totals.** Total payment was EMI × months before rounding, so the trail did not add up.
   Total = rounded EMI × months; interest = total − principal; 0% → principal/months.
10. **Display leaks.** Spread copies of a quantity carried a stale `display`/`note` (e.g. a
    rounded display reused by the next line). Every derived quantity clears both.
11. **Labels.** `5:30pm` and `3:4` were taken as `label:` definitions. A label needs `: ` or
    end-of-line after the colon.
12. **Kelvin.** `-273.15 c in k` printed `0K`; temperatures print `0 K`, `30°C`, `86°F`.

## Architecture changes

- `docs/ARCHITECTURE.md` documents the pipeline: tokenizer → Pratt parser → typed evaluator →
  formatter, with the NL layer (normalize → tagged words → clause chain → one-shot intents) in front.
- Intents are a fixed, ordered list with explicit gates; a sentence either matches one intent fully
  or falls through to the expression parser, which rejects unknown names and dangling operators.
- Errors carry a kind (`parse` | `data`); data errors (rates, mixed currency) short-circuit so
  no later stage can turn them into a number.
- Previous-result policy is centralised in `lastValidResult(ctx)`.

## Intents and language patterns covered

Arithmetic and precedence, percent forms (of / off / on / as a % of / of what / points /
difference / more-less-than / reverse with outcome), GST add and reverse (CGST/SGST split),
successive discounts, increase/decrease chains with labelled trails, profit/loss, margin↔markup,
EMI (reducing balance and flat), simple/compound interest (asks when ambiguous), revenue/expense
business lines, allocation into named shares, ratio splits, division among people with tip,
item × unit price with tax, lists (sum/avg/median/min/max), unit and compound-unit conversion,
cubic volumes, temperature, data sizes, dates (offsets, last/first day, weekdays, age, leap years,
weekday names, days until/since), time spans with breaks, time-zone conversion (fixed abbreviations
vs IANA cities), live/cached/historical currency with disclosed rate dates.
Languages: English and Hinglish, mixed, with number words in both.

## Known limitations and data dependencies

- `10 % 3` is percent-of, not modulo (Numi convention); use `10 mod 3`.
- `$` is assumed to be USD.
- Historical rates come from the ECB set (frankfurter.dev) and go back to 1999 for major
  currencies only; weekends/holidays use the previous business day and say so.
- Live rates need the network; offline answers are labelled `Cached rate`.
- Public holidays are not known; `weekdays` means Mon–Fri only.
- A line like `asdf 123` defines `asdf` implicitly (Numi behaviour); a lone unknown word errors.
- Time-zone abbreviations are fixed offsets by design (EST is always UTC−5); city names follow DST.
- The NL layer is pattern-based: a sentence outside the covered forms gets a hint, not an answer.

## High-risk areas that still deserve manual checks

- Very long mixed-language sentences with three or more operations.
- Historical conversions across currency redenominations.
- Dates typed as `dd/mm` vs `mm/dd` (the engine reads day-first).
- Rounding of EMI schedules against a bank's own statement (banks differ in the last instalment).

## Reliability upgrade (23 Oct 2026, round two)

No AI integration existed or exists: runtime dependencies are decimal.js and luxon only; the only network
calls are the two exchange-rate providers in the main process; the renderer's CSP is `connect-src 'none'`.

**Baseline.** 36 inputs reported from app testing were replayed against the engine: 13 failed or gave wrong
numbers (power words summed as "17", percent sums read as a ratio, tax rates combined with a discount,
owes/pays and had/spent sentences, multi-target conversions, variables defined mid-sentence). The others
(parenthesised arithmetic, decimals, weekdays, zoned dates) already passed; those app failures came from
an older installed build.

**Benchmark.** `tests/benchmark.test.ts` holds 802 cases in two rounds written after the fixes of the
previous round, with answers worked by hand or with Python's decimal module. All 802 pass:

| Group                       | Cases | Target  | Result |
| --------------------------- | ----: | ------- | ------ |
| core arithmetic             |   109 | ≥ 99.9% | 100%   |
| structured intents          |   510 | ≥ 99%   | 100%   |
| natural-language (Hinglish) |    68 | ≥ 95%   | 100%   |
| must fail clearly           |   115 | 0 wrong | 0 wrong|

The engine suite (550 tests) also passes. Two expected values supplied with the report were themselves
wrong and were not matched: 17.5% of 864 plus 12.5% of 640 divided by 4 is 57.8 (not 69.525), and 4.65
acres is 18,817.88 m² with the international acre (not 18,819.7).

**Known limitations.** "bought at 500" alone echoes 500 (a definition-like line, as in Numi); "apples 5"
defines `apples`; `10 % 3` is percent-of; two durations added print in minutes; durations across two
zones need both clock times; public holidays are unknown; dates are read day-first.
