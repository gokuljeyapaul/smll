#!/usr/bin/env bash
# Verification. Always: plan lint + evidence integrity. With --device (on the Mac): also the full device suite.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/_phase.sh"
echo "verify: phase=$PHASE"
python3 scripts/plan_lint.py
python3 scripts/verify_evidence.py
if [ "${1:-}" = "--device" ]; then
  [ "$PHASE" != "PLAN_ONLY" ] || { echo "verify: FAIL --device requested in phase PLAN_ONLY"; exit 1; }
  bash scripts/preflight.sh
  [ -x scripts/run_flows.sh ] || { echo "verify: FAIL scripts/run_flows.sh missing"; exit 1; }
  bash scripts/run_flows.sh --all
fi
echo "verify: OK"
