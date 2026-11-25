#!/usr/bin/env bash
# R2-2 RED: the new suites failing on the PRE-IMPLEMENTATION app (scaffold
# host-messaging module wired nowhere, pre-change CSS/viewport/meta).
#   part 0 — typecheck + lint MUST pass (the failures below are behavioural,
#            not build errors — a build error is not RED)
#   part 1 — vitest: the host-contract suite (A44) + the hosting/source
#            checks (A42/A43/A46) against the scaffold
#   part 2 — build:test + playwright chromium on the two new R2-2 specs
# Output: docs/evidence/R2-2/red.log (real output + exit codes).
# Run: bash scripts/run_r2_2_red.sh
set -uo pipefail
cd "$(dirname "$0")/.."
if [ -z "${PLAYWRIGHT_BROWSERS_PATH:-}" ] || [ ! -w "${PLAYWRIGHT_BROWSERS_PATH:-}" ]; then
  export PLAYWRIGHT_BROWSERS_PATH=/opt/data/home/.cache/ms-playwright
fi
EV=docs/evidence/R2-2
mkdir -p "$EV"

{
  echo "== R2-2 RED: typecheck + lint (proof the failures below are behavioural, not build errors) =="
  npm run typecheck
  echo "typecheck exit code: $?"
  npm run lint
  echo "lint exit code: $?"
} > "$EV/red.log" 2>&1

echo "== R2-2 RED part 1: host-contract suite (A44) + hosting/source checks (A42/A43/A46) on the scaffold ==" >> "$EV/red.log"
npx vitest run src/host >> "$EV/red.log" 2>&1
echo "vitest (host suites) exit code: $?" >> "$EV/red.log"

echo "== R2-2 RED part 2: the new Playwright flows (chromium, TEST build) ==" >> "$EV/red.log"
npm run --silent build:test >> "$EV/red.log" 2>&1
BUILD_EXIT=$?
npx playwright test e2e/r2_2_responsive.spec.ts e2e/r2_2_embedded.spec.ts \
  --project=chromium --reporter=list >> "$EV/red.log" 2>&1
PW_EXIT=$?
echo "build:test exit code: $BUILD_EXIT; playwright (new R2-2 specs, chromium) exit code: $PW_EXIT" >> "$EV/red.log"
echo "RED run complete"
