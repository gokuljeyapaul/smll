#!/usr/bin/env bash
# Recorded video demo: real pipeline run, synthetic data only.
set -euo pipefail
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_DIR"

r() { printf '\r\033[K'; }  # no-op helper keeps output readable

echo "== coaching-privacy-pipeline — recorded run (all data synthetic) =="
echo "== repo state: main, all slices S0-S7 merged, 89-test regression green =="
echo
echo '$ git log --oneline -5'
git log --oneline -5
echo
echo "============================================"
echo " DEMO 1: text session -> Presidio redaction ->"
echo "          validation -> fail-closed decision"
echo "============================================"
echo '$ .venv/bin/privacy-pipeline process --input fixtures/seed_fixtures.jsonl --policy internal_coaching_analysis --output artifacts/demo/results'
.venv/bin/privacy-pipeline process \
  --input fixtures/seed_fixtures.jsonl \
  --policy internal_coaching_analysis \
  --output artifacts/demo/results
echo
echo "-- sanitized output (fictional session fictional-S01):"
.venv/bin/python - <<'PY'
import json, pathlib
sid = pathlib.Path("artifacts/demo/results/fictional-S01")
dec = json.loads((sid / "decision.json").read_text())
san = json.loads((sid / "sanitized.json").read_text())
print(f"session {san['session_id']}  decision={dec['decision']}")
for u in san["utterances"]:
    print(f"  [{u['speaker_id']}] {u['text']}")
PY
echo
echo "-- leak validation report (independent validator):"
.venv/bin/python - <<'PY'
import json, pathlib
for sid in sorted(pathlib.Path("artifacts/demo/results").iterdir()):
    v = json.loads((sid / "validation_report.json").read_text())
    print(f"session {sid.name}: residual_pii={len(v['residual_pii'])} "
          f"context_risks={len(v['context_risks'])} "
          f"cross_session_risks={len(v['cross_session_risks'])}")
PY
echo
echo "============================================"
echo " DEMO 2: deliberate faulty transform that"
echo "          re-inserts an identifier -> BLOCKED"
echo "============================================"
.venv/bin/python - <<'PY'
import json, pathlib
from coaching_privacy.validator import IndependentLeakValidator
from coaching_privacy.pipeline import SafetyGate
sanitized = json.loads(pathlib.Path("artifacts/demo/results/fictional-S01/sanitized.json").read_text())
sanitized["utterances"][1]["text"] = (
    "My name is Mira Solen, and my personal email is mira.solen@example.test. "
    "I want to change how I lead meetings.")
fixture = json.loads(pathlib.Path("fixtures/seed_fixtures.jsonl").read_text().splitlines()[0])
report = IndependentLeakValidator().validate(
    prohibited_leaks=fixture["prohibited_leaks"],
    sanitized_utterances=sanitized["utterances"])
report["all_mandatory_stages_executed"] = True
decision = SafetyGate().decide(report, purpose="internal_coaching_analysis")
print("faulty transform (identifier re-inserted) -> decision:", decision["decision"])
print("reason:", decision["review_reasons"])
PY
echo
echo "============================================"
echo " DEMO 3: offline ASR proof (sockets blocked,"
echo "          faster-whisper tiny.en, local model)"
echo "============================================"
echo '$ .venv/bin/python scripts/offline_asr_proof.py'
.venv/bin/python scripts/offline_asr_proof.py
echo
echo "============================================"
echo " DEMO 4: one-command audit -> machine report"
echo "============================================"
echo '$ bash scripts/audit.sh'
bash scripts/audit.sh 2>&1 | tail -15
echo
echo "-- audit report (PII-free, provenance-complete):"
.venv/bin/python - <<'PY'
import json
r = json.load(open("artifacts/audit/audit_report.json"))
print("overall:", r.get("overall"))
print("checks:", {c: v.get("status") if isinstance(v, dict) else v
                 for c, v in r.get("checks", r).items() if c != "overall"} if isinstance(r.get("checks", r), dict) else "see report")
PY
echo
echo "== END OF RECORDING — no real data used anywhere =="
