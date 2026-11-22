#!/usr/bin/env bash
# S3 RED run: vitest (unit RED) + production build + test build + Playwright
# in Chromium and WebKit against the S2 app with the new S3 behavioral specs,
# with real exit codes, to docs/evidence/S3/red.log. RED = assertion failures
# on missing behavior (the S3 model-manager scaffold exists but has no
# behavior; the app UI has no model card yet), exactly like the S1/S2 pattern.
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
if [ -z "${PLAYWRIGHT_BROWSERS_PATH:-}" ] || [ ! -w "${PLAYWRIGHT_BROWSERS_PATH:-}" ]; then
  export PLAYWRIGHT_BROWSERS_PATH="$HOME/.cache/ms-playwright"
fi
EV=docs/evidence/S3
mkdir -p "$EV" artifacts
rm -f artifacts/model-server.log
LOG="$EV/red.log"

{
echo "# S3 RED evidence — real commands, real output, captured $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo
echo "RED state: the S2 app is unchanged (no model UI); the S3 model-manager"
echo "scaffold exists (src/model/* — no behavior yet: sha256 returns the"
echo "all-zero digest, the state machine ignores events, integrity checks"
echo "always claim ok, the manager does nothing), and the new behavioral"
echo "tests (vitest model suite + Playwright a12/a13/a14 specs) must fail on"
echo "assertions (not import/build errors). The S0+S1+S2 regression tests"
echo "must stay green in the same run."
echo

echo "## \$ npx vitest run"
npx vitest run
echo "VITEST_EXIT=$?"
echo

echo "## \$ npm run build (production build of the scaffold tree)"
npm run build --silent
echo "BUILD_EXIT=$?"
echo

echo "## \$ npm run build:test (test build for the S3 e2e specs)"
npm run build:test --silent
echo "BUILD_TEST_EXIT=$?"
echo

echo "## \$ npx playwright test --project=chromium --reporter=list"
npx playwright test --project=chromium --reporter=list
echo "CHROMIUM_EXIT=$?"
echo

echo "## \$ npx playwright test --project=webkit --reporter=list"
npx playwright test --project=webkit --reporter=list
echo "WEBKIT_EXIT=$?"
echo

echo "# End of S3 RED log."
} 2>&1 | tee "$LOG"
