# Keeping the tax and finance rules current

FATAAK answers tax and finance questions from one dated table: `src/engine/rules.ts` (`RULES`). The app shows
`RULES.asOf` under Settings → Check for updates ("rules as of …"). Nothing else in the code carries a year-specific
figure; `src/engine/fixed.ts` and `src/engine/extras.ts` read from this table.

## Weekly review (automated routine, or by hand)

1. Check the sources listed in `RULES.sources` for anything that changes a figure in `RULES`:
   - income-tax slabs, 87A rebate limit, standard deduction, surcharge bands, cess (Finance Act / Budget, CBDT)
   - TDS thresholds on interest and rent, capital-gains rates (CBDT, Budget)
   - GST slab structure (GST Council press releases)
   - EPF contribution rates, EPS wage ceiling, the EPFO interest rate for the year (EPFO)
   - PPF rate (quarterly small-savings notification, Ministry of Finance)
   - ESI rates and wage ceiling (ESIC)
   - deposit insurance limit (DICGC), cash receipt limit (269ST)
2. If nothing changed: update only `RULES.asOf` to today's date, commit `rules: reviewed <date>, no change`.
   No release is needed for a date-only change more than once a month; the Settings line stays honest anyway.
3. If something changed:
   - edit the figure in `rules.ts`; add a new `newRegime[<year>]` entry for a new financial year and move
     `defaultFy` only when that year has begun (1 April);
   - update the independent oracle in `tests/gen/generate.py` (`NEW_BY_FY`, surcharge, thresholds) so the
     expectations are derived from the sources, never from the engine;
   - update the strings in `tests/fixed.test.ts` and `tests/regression5.test.ts` that quote the old figures;
   - run `npm run typecheck` and `npm test` (all green);
   - add a release note in `src/shared/changelog.ts` ("Rules: …", with the source and effective date);
   - bump the patch version (`npm version patch --no-git-tag-version`), commit, tag `vX.Y.Z`, push with
     `--follow-tags`. The release workflow builds the zip and every installed copy picks it up through
     Check for updates.
4. Never guess. If a source is ambiguous or the change has not taken effect yet, leave the figure, note the
   pending change in this file under "Pending", and let a human decide.

## How the weekly review runs

- **On the maintainer's laptop:** double-click `scripts\Register-WeeklyRulesReview.cmd` once. It registers a
  per-user Windows scheduled task (no admin) that runs `scripts\weekly-rules-review.ps1` every Monday at 09:00. The
  script pulls `main`, then runs Claude Code headless (the `claude.exe` on PATH, or the copy shipped with the Claude
  desktop app) with the procedure above as its prompt; Claude checks the sources, edits only on a confirmed change,
  runs the tests, and pushes a tagged release. Logs: `%LOCALAPPDATA%\FATAAK-rules-review\review-<date>.log`.
  One-time setup: run `claude.exe` in a terminal, type `/login`, finish in the browser, `/exit`.
- **On GitHub:** `.github/workflows/rules-reminder.yml` opens (or refreshes) one `rules-review` issue every Monday
  with the checklist above, so a missed week is visible even when the laptop was off. Close it when done.
- **Cloud routine (optional):** the same prompt can run as a claude.ai routine once the GitHub connection is
  allowed for the account; the laptop task does the same job without it.

## Pending

(none)

## History

- 24 Oct 2026 — initial table: FY 2023-24 to 2025-26 new-regime slabs, old regime, surcharge, cess, TDS thresholds
  (Budget 2025), GST two-slab structure (22 Sep 2025), EPF/PPF/ESI rates.
