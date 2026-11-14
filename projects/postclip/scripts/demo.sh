#!/usr/bin/env bash
# Demo. PLAN_ONLY: NOT_RUN (exit 0), stated honestly. BUILDING/COMPLETE: builds the app and runs the
# end-to-end demo flows in real browsers (npm run demo); a missing script is a failure.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/_phase.sh"
if [ "$PHASE" = "PLAN_ONLY" ]; then
  echo "DEMO: NOT_RUN — phase PLAN_ONLY, no slice delivered (this is not a pass)."
  exit 0
fi
grep -q '"demo"' package.json 2>/dev/null || { echo "demo: FAIL package.json has no demo script in phase $PHASE"; exit 1; }
npm run --silent demo
echo "demo: OK"
