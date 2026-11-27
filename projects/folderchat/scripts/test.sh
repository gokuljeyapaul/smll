#!/usr/bin/env bash
# S0 real test suite: ruff, mypy (strict on src/), pytest fast+slow with JUnit.
# 'bench' (full evals + candidate benches) runs on the building host only, via
# scripts/run_s0_final_evidence.sh.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
PHASE="$(bash "$(dirname "${BASH_SOURCE[0]}")/_phase.sh")"
echo "test: phase=$PHASE"
if [ "$PHASE" = "PLAN_ONLY" ]; then
  echo "test: FAIL phase is PLAN_ONLY but this is the real test script" >&2
  exit 1
fi
.venv/bin/ruff check src tests scripts/gen_fixtures.py scripts/fetch_model.py scripts/verify_evidence.py scripts/gen_ship_rule.py scripts/gen_s0_summary.py
.venv/bin/mypy
EV="${FOLDERCHAT_EVIDENCE_DIR:-docs/evidence/S0}"
mkdir -p "$EV/junit"
# two-pass junit bootstrap: stage first, promote only after green (never leave a
# truncated JUnit behind for the evidence-integrity checks to read)
.venv/bin/python -m pytest tests -m "fast or slow" \
  --junitxml="$EV/junit/host.staging.xml" -q
mv "$EV/junit/host.staging.xml" "$EV/junit/host.xml"
echo "test: OK"
