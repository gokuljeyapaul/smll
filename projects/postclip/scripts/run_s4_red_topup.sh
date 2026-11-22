#!/usr/bin/env bash
# S4 RED top-up: the first RED pass captured the vitest RED (40 behavioral
# failures, 194 regression green) and the chromium a21 failures on the
# missing model-cleanup UI, but the uc13/eval specs HUNG in unactionable
# locator .check() calls against the missing toggle (Playwright action
# waits have no default timeout, so they ran to their 20/75-minute test
# budgets). The specs now use a bounded 30s waitFor before the toggle
# action — the same missing-UI failure, recorded in seconds instead of a
# hang. This top-up runs those specs against the SAME pre-feature test
# build (the S3-era dist; the scaffold tree's build:test tsc step had also
# failed on the not-yet-implemented ShareExtras test contract — both
# explained in the addendum) and appends the real output to red.log.
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
if [ -z "${PLAYWRIGHT_BROWSERS_PATH:-}" ] || [ ! -w "${PLAYWRIGHT_BROWSERS_PATH:-}" ]; then
  export PLAYWRIGHT_BROWSERS_PATH="$HOME/.cache/ms-playwright"
fi
EV=docs/evidence/S4
LOG="$EV/red.log"

{
echo
echo "## RED top-up (bounded-wait specs, same pre-feature test build) — captured $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo

echo "## \$ npx playwright test --project=chromium --reporter=list --grep 'uc13_injection|eval_llm'"
npx playwright test --project=chromium --reporter=list --grep 'uc13_injection|eval_llm'
echo "CHROMIUM_TOPUP_EXIT=$?"
echo

echo "## \$ npx playwright test --project=webkit --reporter=list --grep 'a21_model_cleanup|uc13_injection|eval_llm'"
npx playwright test --project=webkit --reporter=list --grep 'a21_model_cleanup|uc13_injection|eval_llm'
echo "WEBKIT_TOPUP_EXIT=$?"
echo

echo "# End of S4 RED log."
} 2>&1 | tee -a "$LOG"
