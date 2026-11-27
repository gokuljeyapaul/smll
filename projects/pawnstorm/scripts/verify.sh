#!/usr/bin/env bash
# PLAN-ONLY verify: plan lint + ledger honesty (PLAN_ONLY may claim no PASS).
# S0 replaces this with plan lint + evidence integrity (summary.json, JUnit-backed PASS, source digest).
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
source scripts/plan_only_guard.sh
python3 scripts/plan_lint.py
if grep -Eq '\| *PASS *\|' docs/status.md; then echo "FAIL: docs/status.md claims PASS in PLAN_ONLY"; exit 1; fi
echo "verify OK (PLAN_ONLY)"
