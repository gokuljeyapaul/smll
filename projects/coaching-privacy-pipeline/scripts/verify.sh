#!/usr/bin/env bash
# Verify schemas, gate decisions, and evidence for the delivered slices (S0-aware).
set -euo pipefail
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_DIR"
.venv/bin/python -m pytest tests/unit tests/integration tests/e2e tests/negative -q
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
