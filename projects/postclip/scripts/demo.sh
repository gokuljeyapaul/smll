#!/usr/bin/env bash
# Demo.
#  PLAN_ONLY: NOT_RUN (exit 0), stated honestly.
#  BUILDING (Stage L, Linux): runs the HOST demo (`npm run demo:host`); a missing script is a failure.
#  DEVICE_VERIFICATION / COMPLETE: on a Mac runs the real device flows (scripts/run_flows.sh); on CI or
#  Linux it runs only the host demo and says device flows are NOT_RUN there.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/_phase.sh"
if [ "$PHASE" = "PLAN_ONLY" ]; then
  echo "DEMO: NOT_RUN — phase PLAN_ONLY, no slice delivered (this is not a pass)."
  exit 0
fi
host_demo() {
  grep -q '"demo:host"' package.json 2>/dev/null || { echo "demo: FAIL package.json has no demo:host script in phase $PHASE"; exit 1; }
  npm run --silent demo:host
}
if [ "$PHASE" = "BUILDING" ]; then
  host_demo
  echo "DEMO: host demo only; device flows are NOT_RUN (Stage D)."
  echo "demo: OK"
  exit 0
fi
if [ -n "${CI:-}" ] || [ "$(uname -s)" != "Darwin" ]; then
  host_demo
  echo "DEMO: device flows NOT_RUN on this host (they run on the Mac); committed evidence is checked by scripts/verify.sh."
  echo "demo: OK"
  exit 0
fi
[ -x scripts/run_flows.sh ] || { echo "demo: FAIL scripts/run_flows.sh missing in phase $PHASE"; exit 1; }
bash scripts/run_flows.sh
echo "demo: OK"
