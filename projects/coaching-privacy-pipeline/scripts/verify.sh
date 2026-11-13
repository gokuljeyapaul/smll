#!/usr/bin/env bash
# Verify model manifest, artifacts and evidence (I16: the pytest suite is run
# once, authoritatively, by scripts/test.sh; verify.sh no longer duplicates it).
set -euo pipefail
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_DIR"
echo "== model manifest sha256 verification (issue #18) =="
.venv/bin/python scripts/verify_models.py
echo "== fast lane bounded check (I16) =="
timeout 120 .venv/bin/python -m pytest -m fast -q
.venv/bin/python - <<'PY'
import json, pathlib
root = pathlib.Path("artifacts/demo/results")
assert root.is_dir(), "demo results missing; run scripts/demo.sh first"
states = set()
for d in root.iterdir():
    if not d.is_dir():  # e.g. batch_linkage_report.json (I23-S2) at the root
        continue
    decision = json.loads((d / "decision.json").read_text())["decision"]
    states.add(decision)
    assert (d / "sanitized.json").is_file()
    assert (d / "validation_report.json").is_file()
print("verify OK: all demo sessions produced decision/report/sanitized; states observed:", states)
PY
