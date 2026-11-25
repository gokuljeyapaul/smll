#!/usr/bin/env bash
# R2-3 RED evidence (plan slice S9 / issue #78): the new persistence flows
# fail on the CURRENT app — no Advanced section (the 397 MB download is a
# front-page card), no "ready (cached)" state, persist() never requested,
# no verified marker, the volatile case shows the download instead of the
# kind explanation — and the Vitest storage-decision suite fails on the
# scaffolded, unwired policy. Build/import errors are NOT RED: the run
# type-checks and builds first to prove the failures are behavioural.
set -uo pipefail
cd "$(dirname "$0")/.."
if [ -z "${PLAYWRIGHT_BROWSERS_PATH:-}" ] || [ ! -w "${PLAYWRIGHT_BROWSERS_PATH:-}" ]; then
  export PLAYWRIGHT_BROWSERS_PATH="$HOME/.cache/ms-playwright"
fi
EV=docs/evidence/R2-3
mkdir -p "$EV"

OUT="$(mktemp)"
{
  echo "== R2-3 RED: typecheck + lint (proof the failures below are behavioural, not build errors) =="
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

  echo "== R2-3 RED part 1: the storage-offer decision suite (A38) on the unwired scaffold =="
  echo "$ npx vitest run src/model/storage-policy.test.ts"
  npx vitest run src/model/storage-policy.test.ts 2>&1 | tail -45
  UNIT_EXIT=${PIPESTATUS[0]}
  echo "vitest (storage-policy suite) exit code: $UNIT_EXIT"
  echo

  echo "== R2-3 RED part 2: the new persistence e2e flows against the CURRENT app (A37/A39/A40) =="
  echo "$ npm run build:test  (the current, unchanged app — the new spec runs against it)"
  npm run build:test --silent 2>&1 | tail -5
  BUILD_EXIT=$?
  echo "build:test exit code: $BUILD_EXIT"
  echo
  if [ "$BUILD_EXIT" = 0 ]; then
    echo "$ npx playwright test e2e/r2_3_model_once.spec.ts --project=chromium --reporter=list"
    npx playwright test e2e/r2_3_model_once.spec.ts --project=chromium --reporter=list 2>&1 | tail -60
    E2E_EXIT=${PIPESTATUS[0]}
    echo "playwright (new R2-3 spec, chromium) exit code: $E2E_EXIT"
  else
    E2E_EXIT=1
    echo "build failed — RED invalid (build errors are not RED)"
  fi
  echo
  echo "== R2-3 RED part 3: the measured environments (recorded BEFORE any change — issue #78 'reproduce and find which first') =="
  echo "$ node scripts/probe_storage_envs.mjs (already recorded: docs/evidence/R2-3/env-probe.json)"
  if [ -f "$EV/env-probe.json" ]; then
    echo "env-probe.json present ($(wc -c < "$EV/env-probe.json") bytes)"
  else
    echo "env-probe.json MISSING"
  fi
  echo

  if [ "$TYPECHECK_EXIT" = 0 ] && [ "$LINT_EXIT" = 0 ] && [ "$UNIT_EXIT" != 0 ] && [ "$E2E_EXIT" != 0 ] && [ -f "$EV/env-probe.json" ]; then
    echo "R2-3 RED: ALL PARTS FAILED AS REQUIRED (real assertion failures on the missing behaviour)."
    RED_EXIT=0
  else
    echo "R2-3 RED: UNEXPECTED — typecheck=$TYPECHECK_EXIT lint=$LINT_EXIT unit=$UNIT_EXIT e2e=$E2E_EXIT (unit and e2e must be non-zero, typecheck/lint zero)."
    RED_EXIT=1
  fi
  echo "$RED_EXIT" > "$OUT.exit"
} 2>&1 | tee "$EV/red.log"
RED_EXIT="$(cat "$OUT.exit")"
rm -f "$OUT.exit"

exit "$RED_EXIT"
