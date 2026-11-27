#!/usr/bin/env bash
# PLAN-ONLY tests: the plan linter's self-test, the plan lint itself, and the shared
# issue generator parsing this plan. S0 replaces this with the real suite (pytest unit /
# integration / e2e, real-model tests, Playwright where the plan says so).
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
source scripts/plan_only_guard.sh
python3 scripts/plan_lint.py --self-test
python3 scripts/plan_lint.py
python3 ../../tools/gen_issues.py --project "$(basename "$PWD")" > /dev/null
echo "plan-only tests OK (no product code exists yet; acceptance IDs are all NOT_RUN)"
