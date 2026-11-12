#!/usr/bin/env bash
# Verify schemas, gate decisions, and evidence for the delivered slices (S3-aware).
# Test suite runs in 3 chunks to bound wall-clock on CPU (GLiNER inference).
set -euo pipefail
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_DIR"
echo "== chunk 1: unit + negative =="
.venv/bin/python -m pytest tests/unit tests/negative -q
echo "== chunk 2: integration =="
.venv/bin/python -m pytest tests/integration -q
echo "== chunk 3: e2e =="
.venv/bin/python -m pytest tests/e2e -q
.venv/bin/python - <<'PY'
import json, pathlib
root = pathlib.Path("artifacts/demo/results")
assert root.is_dir(), "demo results missing; run scripts/demo.sh first"
states = set()
for d in root.iterdir():
    decision = json.loads((d / "decision.json").read_text())["decision"]
    states.add(decision)
    assert (d / "sanitized.json").is_file()
    assert (d / "validation_report.json").is_file()
print("verify OK: all demo sessions produced decision/report/sanitized; states observed:", states)
PY
