#!/usr/bin/env bash
# S0 real setup: project venv + pinned deps + editable install + pinned model download
# with size+sha256 verification (A01). Idempotent; offline-safe once models are fetched.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
PHASE="$(bash "$(dirname "${BASH_SOURCE[0]}")/_phase.sh")"
echo "setup: phase=$PHASE"
if [ "$PHASE" = "PLAN_ONLY" ]; then
  echo "setup: FAIL phase is PLAN_ONLY but this is the real setup script" >&2
  exit 1
fi
bash scripts/preflight.sh build
PY="${FOLDERCHAT_PYTHON:-python3}"
if [ ! -x .venv/bin/python ]; then "$PY" -m venv .venv; fi
.venv/bin/pip install -U pip setuptools wheel >/dev/null
.venv/bin/pip install -r requirements.txt
.venv/bin/pip install -e . --no-deps
# every pinned role model: download once into gitignored .cache/models/ and verify
.venv/bin/python scripts/fetch_model.py
# Playwright Chromium arrives with S1 (the first web-platform slice); recorded in
# docs/evidence/S0/summary.json limitations.
echo "setup: OK"
