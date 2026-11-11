#!/usr/bin/env bash
# Install Python .venv, pinned dependencies, spaCy en_core_web_sm (real Presidio backend).
# Safe to run from any current directory. Exit nonzero on mandatory failures.
set -euo pipefail
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_DIR"
python3 -m venv .venv
.venv/bin/pip install --quiet --upgrade pip
.venv/bin/pip install --quiet "spacy>=3.7,<3.9" "presidio-analyzer" "presidio-anonymizer" "pydantic" "pyyaml" "pytest"
.venv/bin/pip install --quiet -e .
if ! .venv/bin/python -c "import spacy; spacy.load('en_core_web_sm')" 2>/dev/null; then
  .venv/bin/python -m spacy download en_core_web_sm
fi
.venv/bin/python - <<'PY'
from presidio_analyzer import AnalyzerEngine
import spacy
a = AnalyzerEngine()
assert a is not None
print("setup OK: presidio analyzer ready; spacy", spacy.__version__, "en_core_web_sm loaded")
PY
