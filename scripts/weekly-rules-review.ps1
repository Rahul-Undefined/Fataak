# FATAAK weekly rules review, run by a per-user Windows scheduled task (see Register-WeeklyRulesReview.cmd).
# It asks Claude Code (headless) to follow docs/RULES.md: check the official sources, update src/engine/rules.ts
# only on a confirmed change, run the tests, and push a tagged release. Logs go to %LOCALAPPDATA%\FATAAK-rules-review.
#
# One-time setup: open PowerShell, run the claude.exe found below without arguments, type /login, finish in the
# browser, type /exit. The task then uses that login.
$ErrorActionPreference = 'Continue'
$repo = Split-Path -Parent $PSScriptRoot
$logDir = Join-Path $env:LOCALAPPDATA 'FATAAK-rules-review'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$log = Join-Path $logDir ("review-" + (Get-Date -Format 'yyyy-MM-dd') + ".log")
"=== $(Get-Date -Format 'yyyy-MM-dd HH:mm') FATAAK rules review ===" | Out-File -FilePath $log -Append -Encoding utf8

# the newest Claude Code binary: the one on PATH, else the copy shipped with the Claude desktop app
$claude = (Get-Command claude -ErrorAction SilentlyContinue).Source
if (-not $claude) {
  $claude = Get-ChildItem -Path (Join-Path $env:LOCALAPPDATA 'Claude-Data') -Recurse -Filter 'claude.exe' -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1 -ExpandProperty FullName
}
if (-not $claude) { "no claude.exe found; install Claude Code or the Claude desktop app" | Out-File $log -Append; exit 1 }
"using $claude" | Out-File $log -Append -Encoding utf8

Set-Location $repo
git fetch origin 2>&1 | Out-File $log -Append
git checkout main 2>&1 | Out-File $log -Append
git pull --ff-only origin main 2>&1 | Out-File $log -Append

$prompt = @'
You maintain FATAAK, a deterministic Windows calculator (Electron + TypeScript) in this repository (branch main). Your job this week: check whether any Indian tax or finance rule FATAAK calculates with has changed, and if so update the app and ship it. Work carefully; wrong tax figures are worse than stale ones.

Read docs/RULES.md first: it is the procedure. All year-specific figures live in src/engine/rules.ts (the RULES object, with asOf and sources). Nothing else in the code should carry such a figure.

1. For each item in RULES (income-tax slabs per financial year, 87A rebate limit, standard deduction, surcharge bands and the new-regime cap, cess, 80C/80D/80CCD(1B) limits, TDS thresholds on interest and rent, professional tax maximum, gratuity tax-free limit, capital-gains rates, GST slab structure, EPF contribution rates and EPS wage ceiling, EPFO interest rate, PPF rate and limit, ESI rates and wage ceiling, DICGC deposit insurance, section 269ST cash limit), check the official source with WebFetch or WebSearch: incometaxindia.gov.in and CBDT circulars, the Finance Act / Union Budget documents, gstcouncil.gov.in, epfindia.gov.in, the Ministry of Finance small-savings notification, esic.gov.in, dicgc.org.in. Prefer official pages; a news article alone is not enough to change a figure.
2. If a figure has changed AND the change has taken effect: edit src/engine/rules.ts (for a new financial year add a newRegime entry; move defaultFy only once that year has begun on 1 April); update the independent oracle in tests/gen/generate.py (NEW_BY_FY, surcharge, thresholds) and the strings in tests/fixed.test.ts and tests/regression5.test.ts that quote old figures; run `python tests/gen/generate.py`; add a release note at the top of src/shared/changelog.ts (version = next patch, date = today, changed: ['Rules: <what>, effective <date>, source <where>']); set RULES.asOf to today's ISO date; append a History line in docs/RULES.md.
3. If nothing changed: update only RULES.asOf and the History line in docs/RULES.md; commit `rules: reviewed <date>, no change`; push to main; no tag.
4. Whenever rules changed: run `npm run typecheck` and `npm test`; every test must pass. Then `npm version patch --no-git-tag-version`, commit with a message starting `rules:`, create an annotated tag v<new version>, and `git push origin main --follow-tags`. The release workflow builds the zip and every installed copy updates itself.
5. If a source is ambiguous, a change is announced but not yet effective, or tests fail: revert the rule change, record the situation under Pending in docs/RULES.md, commit and push only that note, and say clearly what needs a human decision.

End with a short summary: what you checked, what changed (sources, effective dates), the commit/tag pushed, or why you held back.
'@

& $claude -p $prompt --output-format text --permission-mode acceptEdits --allowedTools "Edit,Write,Read,Glob,Grep,WebFetch,WebSearch,Bash(npm *),Bash(npx *),Bash(python *),Bash(git *)" 2>&1 | Out-File $log -Append -Encoding utf8
"exit $LASTEXITCODE at $(Get-Date -Format 'HH:mm')" | Out-File $log -Append -Encoding utf8
