#!/usr/bin/env bash
# Demo. PLAN_ONLY: states honestly that nothing is built (NOT_RUN, exit 0).
# BUILDING/COMPLETE: runs the real flows; a missing runner or any failed flow is a failure.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/_phase.sh"
if [ "$PHASE" = "PLAN_ONLY" ]; then
  echo "DEMO: NOT_RUN — phase PLAN_ONLY, no slice delivered (this is not a pass)."
  exit 0
fi
if [ -n "${CI:-}" ]; then
  echo "DEMO: NOT_RUN on CI — device flows need the Mac; committed evidence is checked by scripts/verify.sh."
  exit 0
fi
[ -x scripts/run_flows.sh ] || { echo "demo: FAIL scripts/run_flows.sh missing in phase $PHASE"; exit 1; }
bash scripts/run_flows.sh
echo "demo: OK"
