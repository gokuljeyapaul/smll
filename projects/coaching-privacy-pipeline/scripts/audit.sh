#!/usr/bin/env bash
# S6 one-command audit (A24): generate corpus -> process -> evaluate -> provenance-
# complete machine report with honest metrics. Scale via AUDIT_SESSIONS
# (spec scale 100 dev; default here balances CI runtime).
set -euo pipefail
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_DIR"
SEED="${AUDIT_SEED:-42}"
SESSIONS="${AUDIT_SESSIONS:-20}"

mkdir -p artifacts/audit
echo "== audit: generating ${SESSIONS} synthetic sessions (seed ${SEED}) =="
.venv/bin/privacy-fixtures generate --seed "$SEED" --sessions "$SESSIONS" \
  --output artifacts/audit/dev.jsonl

echo "== audit: processing through the privacy pipeline =="
.venv/bin/privacy-pipeline process --input artifacts/audit/dev.jsonl \
  --policy internal_coaching_analysis --output artifacts/audit/results

echo "== audit: evaluating against gold truth =="
.venv/bin/privacy-eval run --fixtures artifacts/audit/dev.jsonl \
  --results artifacts/audit/results --output artifacts/audit/reports

echo "== audit: assembling provenance-complete machine report =="
.venv/bin/python - <<'PY'
import json, pathlib
from coaching_privacy import __version__
from coaching_privacy.audit import build_provenance

metrics = json.loads(pathlib.Path("artifacts/audit/reports/summary.json").read_text())
provenance = build_provenance(
    pipeline_version=__version__,
    dataset_seed=42,
    models={
        "detector": "presidio-analyzer",
        "nlp_backend": "spaCy en_core_web_sm",
        "context_extractor": "urchade/gliner_medium-v2.1",
        "asr": "faster-whisper tiny.en",
    },
    policy="internal_coaching_analysis",
)
report = {
    "schema_version": "1.0",
    "provenance": provenance,
    "metrics": metrics,
    "honesty_note": (
        "All scores are measured on synthetic fictional data only. They are not "
        "a claim of anonymity, ICF or legal compliance for real coaching data."
    ),
}
out = pathlib.Path("artifacts/audit/audit_report.json")
out.write_text(json.dumps(report, indent=2) + "\n")
print("audit report:", out)
PY
echo "== audit: DONE =="
