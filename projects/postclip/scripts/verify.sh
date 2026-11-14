#!/usr/bin/env bash
# Verification: plan lint + evidence integrity (always); the full suite is scripts/test.sh.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/_phase.sh"
echo "verify: phase=$PHASE"
python3 scripts/plan_lint.py
python3 scripts/verify_evidence.py
echo "verify: OK"
