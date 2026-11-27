#!/usr/bin/env bash
# PLAN-ONLY demo: the observable result of the plan phase is the slice work queue the
# building agent will execute. S0 replaces this with the real end-to-end demo.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
source scripts/plan_only_guard.sh
python3 ../../tools/gen_issues.py --project "$(basename "$PWD")" | head -n 80
