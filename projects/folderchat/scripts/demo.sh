#!/usr/bin/env bash
# S0 real demo: the issue #93 observable result, offline after setup.
#   folderchat add fixtures/corpus  -> index
#   folderchat ask "What is the travel reimbursement limit?" -> cited answer
#   folderchat ask <unanswerable> -> "not found" + closest passages
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
source scripts/_phase.sh
echo "demo: phase=$PHASE"
if [ "$PHASE" = "PLAN_ONLY" ]; then
  echo "demo: FAIL phase is PLAN_ONLY but this is the real demo script" >&2
  exit 1
fi
export FOLDERCHAT_DATA_DIR="$(mktemp -d)/folderchat-demo"
mkdir -p "$FOLDERCHAT_DATA_DIR"
LOG="${FOLDERCHAT_DEMO_LOG:-docs/evidence/S0/demo.log}"
{
  echo "== folderchat add fixtures/corpus =="
  .venv/bin/folderchat add fixtures/corpus
  echo
  echo "== folderchat ask \"What is the travel reimbursement limit?\" =="
  .venv/bin/folderchat ask "What is the travel reimbursement limit?"
  echo
  echo "== folderchat ask \"What is the CEO's favourite colour?\" (unanswerable) =="
  .venv/bin/folderchat ask "What is the CEO's favourite colour?"
} 2>&1 | tee "$LOG"
echo "demo: OK (log: $LOG)"
