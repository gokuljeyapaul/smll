#!/usr/bin/env bash
# R2-1 RED evidence (plan slice S7: "the new share-arrival Playwright flows
# fail on the current app … and the Vitest state-machine suite fails on the
# scaffolded, unwired transition table"). Runs on the R2-1 branch BEFORE the
# implementation: the new tests exist, the app does not have the behaviour
# yet. Both parts must FAIL with assertion failures (exit 1) — their real
# output is docs/evidence/R2-1/red.log. Build/import errors are NOT RED;
# the run type-checks and builds first to prove the failures are
# behavioural.
set -uo pipefail
cd "$(dirname "$0")/.."
if [ -z "${PLAYWRIGHT_BROWSERS_PATH:-}" ] || [ ! -w "${PLAYWRIGHT_BROWSERS_PATH:-}" ]; then
  export PLAYWRIGHT_BROWSERS_PATH="$HOME/.cache/ms-playwright"
fi
EV=docs/evidence/R2-1
mkdir -p "$EV"

OUT="$(mktemp)"
{
  echo "== R2-1 RED: typecheck + lint (proof the failures below are behavioural, not build errors) =="
  echo "$ npm run typecheck"
  npm run typecheck 2>&1
  TYPECHECK_EXIT=$?
  echo "typecheck exit code: $TYPECHECK_EXIT"
  echo
  echo "$ npm run lint"
  npm run lint 2>&1 | tail -5
  LINT_EXIT=$?
  echo "lint exit code: $LINT_EXIT"
  echo

  echo "== R2-1 RED part 1: the arrival screen-state machine (A34) on the unwired scaffold =="
  echo "$ npx vitest run src/flow/arrival.test.ts"
  npx vitest run src/flow/arrival.test.ts 2>&1 | tail -40
  UNIT_EXIT=${PIPESTATUS[0]}
  echo "vitest (arrival suite) exit code: $UNIT_EXIT"
  echo

  echo "== R2-1 RED part 2: the new share-first e2e flows against the CURRENT app (A32/A33/A35/A36) =="
  echo "$ npm run build:test  (the current, unchanged app — the new specs run against it)"
  npm run build:test --silent 2>&1 | tail -5
  BUILD_EXIT=$?
  echo "build:test exit code: $BUILD_EXIT"
  echo
  if [ "$BUILD_EXIT" = 0 ]; then
    echo "$ npx playwright test e2e/a32_share_first_result.spec.ts e2e/a33_result_first_screen.spec.ts e2e/eval_nested_text_recall.spec.ts --project=chromium --reporter=list"
    npx playwright test e2e/a32_share_first_result.spec.ts e2e/a33_result_first_screen.spec.ts e2e/eval_nested_text_recall.spec.ts --project=chromium --reporter=list 2>&1 | tail -60
    E2E_EXIT=${PIPESTATUS[0]}
    echo "playwright (new R2-1 specs, chromium) exit code: $E2E_EXIT"
  else
    E2E_EXIT=1
    echo "build failed — RED invalid (build errors are not RED)"
  fi
  echo

  if [ "$TYPECHECK_EXIT" = 0 ] && [ "$LINT_EXIT" = 0 ] && [ "$UNIT_EXIT" != 0 ] && [ "$E2E_EXIT" != 0 ]; then
    echo "R2-1 RED: ALL PARTS FAILED AS REQUIRED (real assertion failures on the missing behaviour)."
    RED_EXIT=0
  else
    echo "R2-1 RED: UNEXPECTED — typecheck=$TYPECHECK_EXIT lint=$LINT_EXIT unit=$UNIT_EXIT e2e=$E2E_EXIT (unit and e2e must be non-zero, typecheck/lint zero)."
    RED_EXIT=1
  fi
  echo "$RED_EXIT" > "$OUT.exit"
} 2>&1 | tee "$EV/red.log"
RED_EXIT="$(cat "$OUT.exit")"
rm -f "$OUT.exit"

exit "$RED_EXIT"
