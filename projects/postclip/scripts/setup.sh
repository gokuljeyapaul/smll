#!/usr/bin/env bash
# Project setup. PLAN_ONLY or CI: minimal prerequisites. Otherwise: host-appropriate preflight + npm ci.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/_phase.sh"
echo "setup: phase=$PHASE"
if [ "$PHASE" = "PLAN_ONLY" ] || [ -n "${CI:-}" ]; then
  bash scripts/preflight.sh ci
else
  bash scripts/preflight.sh
fi
if [ "$PHASE" != "PLAN_ONLY" ]; then
  [ -f package.json ] || { echo "setup: FAIL phase $PHASE but no package.json"; exit 1; }
  npm ci
fi
echo "setup: OK"
