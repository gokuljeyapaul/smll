#!/usr/bin/env bash
# postclip-builder is a plan-only stub: this script reports that honestly and checks the stub's integrity.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
for f in README.md AGENTS.md docs/BUILD_PLAN.md docs/status.md milestone-status.json; do
  [ -f "$f" ] || { echo "setup: FAIL missing $f"; exit 1; }
done
grep -q '"phase": "PLAN_ONLY"' milestone-status.json || { echo "setup: FAIL phase is not PLAN_ONLY but no implementation exists"; exit 1; }
echo "postclip-builder setup: NOT_RUN — PLAN_ONLY stub, nothing is built (this is not a pass of any feature)."
