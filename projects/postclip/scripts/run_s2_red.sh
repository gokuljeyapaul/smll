#!/usr/bin/env bash
# S2 RED run: vitest (unit RED) + build (scaffold must build) + Playwright in
# Chromium and WebKit against the S1 app with the new S2 behavioral specs,
# with real exit codes, to docs/evidence/S2/red.log. RED = assertion
# failures on missing behavior, exactly like the S1 pattern.
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
if [ -z "${PLAYWRIGHT_BROWSERS_PATH:-}" ] || [ ! -w "${PLAYWRIGHT_BROWSERS_PATH:-}" ]; then
  export PLAYWRIGHT_BROWSERS_PATH="$HOME/.cache/ms-playwright"
fi
EV=docs/evidence/S2
mkdir -p "$EV"
LOG="$EV/red.log"

{
echo "# S2 RED evidence — real commands, real output, captured $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo
echo "RED state: the S1 app is unchanged; the S2 input-routing scaffold exists"
echo "(src/ingest/route.ts returns null/empty — no behavior yet), and the new"
echo "behavioral tests (vitest route suite + Playwright uc03/a08/a10/a11 specs)"
echo "must fail on assertions (not import/build errors). The S0+S1 regression"
echo "tests must stay green in the same run."
echo

echo "## \$ npx vitest run"
npx vitest run
echo "VITEST_EXIT=$?"
echo

echo "## \$ npm run build"
npm run build --silent
echo "BUILD_EXIT=$?"
echo

echo "## \$ npx playwright test --project=chromium --reporter=list"
npx playwright test --project=chromium --reporter=list
echo "CHROMIUM_EXIT=$?"
echo

echo "## \$ npx playwright test --project=webkit --reporter=list"
npx playwright test --project=webkit --reporter=list
echo "WEBKIT_EXIT=$?"
echo

echo "# End of S2 RED log."
} 2>&1 | tee "$LOG"
