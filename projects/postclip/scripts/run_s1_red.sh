#!/usr/bin/env bash
# S1 RED run: vitest (unit RED) + build (scaffold must build) + Playwright in
# Chromium and WebKit against the scaffold app, with real exit codes, to
# docs/evidence/S1/red.log. RED = assertion failures on missing behavior.
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
if [ -z "${PLAYWRIGHT_BROWSERS_PATH:-}" ] || [ ! -w "${PLAYWRIGHT_BROWSERS_PATH:-}" ]; then
  export PLAYWRIGHT_BROWSERS_PATH="$HOME/.cache/ms-playwright"
fi
EV=docs/evidence/S1
mkdir -p "$EV"
LOG="$EV/red.log"

{
echo "# S1 RED evidence — real commands, real output, captured $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo
echo "RED state: S1 scaffold modules exist (cleanup passthrough, gate accepts everything,"
echo "sniff returns null, audit sees nothing, export builders return ''), the app is the"
echo "S0 app; the new behavioral tests must fail on assertions (not import/build errors)."
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
echo "# End of S1 RED log."
} 2>&1 | tee "$LOG"
