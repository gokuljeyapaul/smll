#!/usr/bin/env bash
# Deterministic end-to-end synthetic demonstration (S0 scope):
# seed fixture -> real Presidio detection -> redaction -> independent
# validation -> fail-closed decision; plus a deliberate-leak rejection demo.
set -euo pipefail
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_DIR"
DEMO_DIR="artifacts/demo"
rm -rf "$DEMO_DIR"; mkdir -p "$DEMO_DIR"
echo "== Demo 1: benign synthetic session -> sanitized output + decision =="
.venv/bin/privacy-pipeline process \
  --input fixtures/seed_fixtures.jsonl \
  --policy internal_coaching_analysis \
  --output "$DEMO_DIR/results"
echo
echo "== Demo 2: faulty transform re-inserts identifier -> BLOCKED =="
.venv/bin/python - <<'PY'
import json, pathlib
from coaching_privacy.validator import IndependentLeakValidator
from coaching_privacy.pipeline import SafetyGate

# Simulate a faulty transform output: the identifier was redacted, then a
# buggy post-processing step re-inserted it into the sanitized utterance.
sanitized = json.loads(
    pathlib.Path("artifacts/demo/results/fictional-S01/sanitized.json").read_text()
)
sanitized["utterances"][1]["text"] = (
    "My name is Mira Solen, and my personal email is mira.solen@example.test. "
    "I want to change how I lead meetings."
)
fixture = json.loads(
    pathlib.Path("fixtures/seed_fixtures.jsonl").read_text().splitlines()[0]
)
validator = IndependentLeakValidator()
report = validator.validate(
    prohibited_leaks=fixture["prohibited_leaks"],
    sanitized_utterances=sanitized["utterances"],
)
report["all_mandatory_stages_executed"] = True
decision = SafetyGate().decide(report, purpose="internal_coaching_analysis")
out = pathlib.Path("artifacts/demo/leak_results/fictional-S01")
out.mkdir(parents=True, exist_ok=True)
(out / "sanitized.json").write_text(json.dumps(sanitized, indent=2) + "\n")
(out / "decision.json").write_text(json.dumps(decision, indent=2) + "\n")
print("leak demo decision:", decision["decision"])
assert decision["decision"] == "BLOCKED", decision
PY
echo
echo "== Decisions =="
for d in "$DEMO_DIR"/results/* "$DEMO_DIR"/leak_results/*; do
  echo "$d: $(.venv/bin/python -c "import json,sys; print(json.load(open(sys.argv[1]))['decision'])" "$d/decision.json")"
done
echo
echo "== Sanitized sample (fictional-S01) =="
.venv/bin/python -c "import json; print(json.dumps(json.load(open('artifacts/demo/results/fictional-S01/sanitized.json'))['utterances'][1], indent=2))"
echo "DEMO_OK"
