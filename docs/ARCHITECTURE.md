# FATAAK calculation architecture

Everything a user types goes through the same deterministic pipeline. No step uses an LLM or `eval`;
arithmetic is exact decimal arithmetic (decimal.js, 34 significant digits, half-up rounding).

```
line text
  │
  ├─ evaluateLine (src/engine/index.ts)
  │    1. comments / headers / "clear context" lines
  │    2. label detection  "Price: $10"  "x = 5"      (colon must be followed by a space)
  │    3. quoted inline comments stripped; "rounded to N decimal places" extracted
  │    4. plain expression   → tokenizer → Pratt parser → typed evaluator
  │    5. data errors (no rate, mixed currencies) stop here — never re-read as prose
  │    6. implicit definition "rahul Rs 100"
  │    7. natural-language intents (src/engine/nl/)
  │    8. last-resort: canonical words rebuilt into an expression (rejects unknown words,
  │       dangling operators and trailing connectors)
  │    9. magnitude guard (|x| ≤ 1e308, no NaN) and optional rounding
  │
  └─ evaluateDocument: variables, block sums, previous-result context, context resets
```

## Core

| Module | Responsibility |
| --- | --- |
| `tokenizer.ts` | numbers (Indian/western grouping, exponents), currency symbols, words, operators, `%`, `!` |
| `parser.ts` | Pratt parser: precedence `^` > unary − > `* /` > `+ −` > conversions (`in/to/as`); percent and unit postfixes; `of/off/on`; functions; list functions; compound targets (`hours and minutes`); dated rates; zone targets |
| `evaluator.ts` | typed `Quantity` arithmetic (number, percent, money, unit, date, time); unit propagation; currency conversion with explicit targets only; block aggregates (`sum`, `average`, `prev`) |
| `finance.ts` | GST add/remove, discount, percent change/difference, profit/loss, margin ↔ markup, reducing-balance EMI, flat-rate loan, simple/compound interest; money rounded half-up to 2 dp |
| `units.ts` | SI-based unit table with authoritative factors (inch 0.0254 m, lb 0.45359237 kg, gallon 3.785411784 l, …), temperature handled separately |
| `dates.ts` / `timezone.ts` | luxon-based literals (absolute, relative, "last day of …", o'clock forms); abbreviations are fixed offsets (EST = UTC−5), places are IANA zones with DST |
| `format.ts` | display rules: numbers ≤ 4 dp, units and money 2 dp, Indian grouping for INR |

## Natural-language layer (`src/engine/nl/`)

1. `normalize.ts` rewrites the sentence into a small canonical vocabulary: number words are composed
   (`five hundred`, `paanch sau`, `1 lakh 20 hazaar`), Hinglish verbs map to `increase`,
   `decrease`, `add`, `remove`, `gst`, `discount`, `divide`, `that`, `then`…; sentence-ending periods and
   clause separators (`,` `;` `then` `and`) are kept as structure.
2. `intents.ts` tags words (numbers, percentages, verbs, connectors, names) and runs intents in a fixed
   order. Each intent either returns a `Quantity`, throws a `CalcError` with a hint (matched but
   ambiguous or incomplete), or returns `null`.
   - `intentChain` is the structured operation model: clauses → start value / named values /
     operations (`+ − × ÷`, percent up/down/of, GST steps, quantity × price) applied in order, with a
     labelled trail in the note.
   - One-shot intents: EMI/loan, interest (asks "simple or compound?" when unstated), revenue/expenses/
     profit/margin, allocation, ratio, list statistics, time spans, GST, discount, profit/loss,
     margin/markup, dates (counts, weekdays, leap years, age), quantity × price, division among
     people, percent questions (of, change, difference, points, reverse), increase/decrease, conversion.

## Guards added in the reliability upgrade

- **Pure-expression gate.** After normalisation, a sentence made only of numbers, percentages, operators
  (`add`/`plus`/`minus`/`times`/`divide`), functions, units and currencies is handed to the parser as one
  expression (`what 35% of 840 plus 12% of 1250` → `35% of 840 + 12% of 1250`). A dangling operator or any
  other word sends it to the intents instead; nothing is ever trimmed.
- **Clause guard.** Every clause of a multi-step sentence must account for all of its words: a leading
  subject noun ("salary 68000", "invoice 4 items"), a descriptor after a unit ("2.75 cubic metres of water"),
  numbers, percentages, verbs and connectors. One unknown word makes the chain refuse the sentence, so
  "Rahul = 2450, Priti = 1875 …" can never be summed as 2450 + 1875.
- **Ordering.** English "X after Y" runs Y first; Hindi "X ke baad Y" runs X first and is rewritten to
  "then" before tax/discount/percent words. A clause whose number follows "on"/"of" is a base; any other
  number after "after"/"becomes" is an outcome (reverse percentage).
- **Multi-statement lines.** A line with `=` and commas/"and"/"then" is split into definitions, expressions,
  `total <name>` and `remaining … from <amount>`; every result is shown and the names stay defined.
- **Deductions vs GST removal.** "tax katke", "tds", "deducted" subtract a percentage; "inclusive", "remove
  gst", "included" reverse an added tax. A percentage followed by a deduction word is never a tax rate.

## Context policy

`that`, `usmein`, `previous result`, `prev` refer to the nearest line above with a value; blank, text and
failed lines are skipped; `clear context` / `reset` is a hard stop that also forgets variables.

## Data sources

- Live rates: open.er-api.com (fallback frankfurter.dev, ECB), fetched by the Electron main process,
  cached on disk with the publication timestamp. The note shows the rate, timestamp and whether it is
  live, cached (offline) or historical with its actual date and source.
- Historical rates: frankfurter.dev v1 (ECB set, ~30 currencies). A weekend/holiday request returns
  the previous business day and says so.
- Time zones: luxon over the platform IANA database.

## Failure policy

Parsing that fails produces a hint, never a plausible number: unknown words next to operators,
dangling operators or connectors, mixed currencies without a target, missing rates, ambiguous finance
questions and overflow all surface as errors in the result column.

## Tests

`npm test` runs vitest: unit tests for the functions (`engine-units`), property checks
(`properties`), paraphrase matrix across languages (`paraphrase`), integration suites from raw input
to displayed text (`arithmetic`, `finance`, `multilingual`, `timezone`, `context`, `regression*`,
`audit`), history/expiry and app-storage behaviour.
