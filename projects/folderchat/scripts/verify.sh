#!/usr/bin/env bash
# S0 real verify: plan lint + evidence integrity (PASS needs a passing JUnit testcase;
# the current slice's summary.json source_digest must match the tree).
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
PHASE="$(bash "$(dirname "${BASH_SOURCE[0]}")/_phase.sh")"
echo "verify: phase=$PHASE"
if [ "$PHASE" = "PLAN_ONLY" ]; then
  echo "verify: FAIL phase is PLAN_ONLY but this is the real verify script" >&2
  exit 1
fi
.venv/bin/python scripts/plan_lint.py
.venv/bin/python scripts/verify_evidence.py
echo "verify: OK"
