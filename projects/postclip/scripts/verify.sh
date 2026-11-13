#!/usr/bin/env bash
# Verification. Always: plan lint + evidence integrity. With --device (on the Mac): also the full device suite.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/_phase.sh"
echo "verify: phase=$PHASE"
python3 scripts/plan_lint.py
python3 scripts/verify_evidence.py
if [ "${1:-}" = "--device" ]; then
  case "$PHASE" in DEVICE_VERIFICATION|COMPLETE) ;; *) echo "verify: FAIL --device is only valid in phase DEVICE_VERIFICATION/COMPLETE (now $PHASE)"; exit 1 ;; esac
  [ "$(uname -s)" = "Darwin" ] || { echo "verify: FAIL --device needs macOS"; exit 1; }
  bash scripts/preflight.sh device
  [ -x scripts/run_flows.sh ] || { echo "verify: FAIL scripts/run_flows.sh missing"; exit 1; }
  bash scripts/run_flows.sh --all
fi
echo "verify: OK"
