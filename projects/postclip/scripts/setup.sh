#!/usr/bin/env bash
# Project setup. PLAN_ONLY: minimal. BUILDING/COMPLETE: preflight, npm ci, Playwright browsers,
# and (once S3 exists) the pinned model download + hash verification.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/_phase.sh"
echo "setup: phase=$PHASE"
bash scripts/preflight.sh
if [ "$PHASE" != "PLAN_ONLY" ]; then
  [ -f package.json ] || { echo "setup: FAIL phase $PHASE but no package.json"; exit 1; }
  npm ci
  npx playwright install --with-deps chromium webkit
  if [ -f scripts/fetch_model.mjs ]; then node scripts/fetch_model.mjs; fi
fi
echo "setup: OK"
