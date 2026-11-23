#!/usr/bin/env bash
# S5 RED run: the new S5 specs + scripts against the pre-S5 behavior (main
# plus the new tests and the perf-mark measurement scaffolding — NO
# behavioral fixes in the tree yet: no strict CSP, no accessibility fixes).
#
# Expected HONEST failures (the plan's RED list for S5):
#   - a29 (production build): the strict CSP does not ship yet -> the
#     production spec + the prod-mode bundle inspection fail on its absence;
#   - eval_large_images: the ~20 MB stress input's OCR stage exceeds the
#     5 s A22 budget (measured ~30 s on noise);
#   - a23: axe on the DARK scheme (the app ships prefers-color-scheme) —
#     the shipped dark button palette fails color contrast.
# Expected passes recorded just as honestly (they were green from the
# start on this tree): the clean-set latency budgets, the keyboard flow,
# the 4000 px fixture within budget.
# The TEST-build bundle inspection is the negative control: the detector
# MUST trip on the test hooks (exit 0 = tripped as designed).
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
EV=docs/evidence/S5
mkdir -p "$EV"
if [ -z "${PLAYWRIGHT_BROWSERS_PATH:-}" ] || [ ! -w "${PLAYWRIGHT_BROWSERS_PATH:-}" ]; then
  export PLAYWRIGHT_BROWSERS_PATH="$HOME/.cache/ms-playwright"
fi
echo "== S5 RED run ($(date -u +%FT%TZ)) ==" > "$EV/red.log"

step() { echo "== $1 ==" | tee -a "$EV/red.log"; }

step "build:test (measurement scaffolding only; no behavioral S5 fixes)"
npm run build:test >> "$EV/red.log" 2>&1
echo "EXIT build:test=$?" | tee -a "$EV/red.log"

step "playwright chromium: the new S5 specs (a23 accessibility, eval_latency budgets, eval_large_images)"
npx playwright test --project=chromium e2e/a23_accessibility.spec.ts e2e/eval_latency_memory.spec.ts e2e/eval_large_images.spec.ts >> "$EV/red.log" 2>&1
echo "EXIT playwright chromium (new specs)=$?" | tee -a "$EV/red.log"

step "production build + a29 spec (the strict CSP must ship; it does not yet)"
npm run build >> "$EV/red.log" 2>&1
echo "EXIT build=$?" | tee -a "$EV/red.log"
POSTCLIP_PROD_RUN=1 npx playwright test --project=chromium e2e/prod >> "$EV/red.log" 2>&1
echo "EXIT playwright chromium prod (a29)=$?" | tee -a "$EV/red.log"

step "bundle inspection: PRODUCTION build (missing strict CSP -> must fail)"
node scripts/inspect_bundle.mjs dist prod >> "$EV/red.log" 2>&1
echo "EXIT inspect prod=$?" | tee -a "$EV/red.log"

step "bundle inspection: TEST build (negative control — must TRIP on the test hooks)"
npm run build:test >> "$EV/red.log" 2>&1
node scripts/inspect_bundle.mjs dist test >> "$EV/red.log" 2>&1
echo "EXIT inspect test-control=$?" | tee -a "$EV/red.log"

echo "== S5 RED run complete ==" | tee -a "$EV/red.log"
