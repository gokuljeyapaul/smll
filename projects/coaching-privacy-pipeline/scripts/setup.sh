#!/usr/bin/env bash
# Install Python .venv, pinned dependencies, spaCy en_core_web_sm (real Presidio backend).
# Safe to run from any current directory. Exit nonzero on mandatory failures.
set -euo pipefail
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_DIR"
python3 -m venv .venv
.venv/bin/pip install --quiet --upgrade pip
.venv/bin/pip install --quiet "spacy>=3.7,<3.9" "presidio-analyzer" "presidio-anonymizer" "pydantic" "pyyaml" "pytest"
# S3: real GLiNER Medium v2.1 offline inference (CPU)
.venv/bin/pip install --quiet "gliner==0.2.30" "transformers==4.57.6" "sentencepiece" "protobuf" "tiktoken"
.venv/bin/pip install --quiet -e .
if ! .venv/bin/python -c "import spacy; spacy.load('en_core_web_sm')" 2>/dev/null; then
  .venv/bin/python -m spacy download en_core_web_sm
fi
# GLiNER checkpoint + backbone tokenizer: download once during controlled setup
if [ ! -f models/gliner_medium-v2.1/model.safetensors ]; then
  .venv/bin/python - <<'PYSETUP'
from huggingface_hub import snapshot_download
snapshot_download(repo_id="urchade/gliner_medium-v2.1",
                  local_dir="models/gliner_medium-v2.1",
                  allow_patterns=["*.json", "*.safetensors", "*.txt", "*.md"])
tok_dir = snapshot_download(repo_id="microsoft/deberta-v3-base",
                  allow_patterns=["tokenizer_config.json", "spm.model", "special_tokens_map.json", "added_tokens.json", "config.json"])
# Make the checkpoint dir fully self-contained (vendored backbone tokenizer)
import shutil, pathlib
for f in ("spm.model", "tokenizer_config.json", "config.json"):
    src = pathlib.Path(tok_dir) / f
    dst = pathlib.Path("models/gliner_medium-v2.1") / f
    if src.is_file() and not dst.is_file():
        shutil.copy(src, dst)
print("backbone tokenizer vendored into models/gliner_medium-v2.1")
PYSETUP
fi
.venv/bin/python - <<'PY'
from presidio_analyzer import AnalyzerEngine
import spacy
a = AnalyzerEngine()
assert a is not None
print("setup OK: presidio analyzer ready; spacy", spacy.__version__, "en_core_web_sm loaded")
PY

# Patch cached tokenizer_config with explicit class (avoids tiktoken misroute)
.venv/bin/python - <<'PYFIX'
import json, glob, pathlib
for snap in glob.glob("/home/*/.cache/huggingface/hub/models--microsoft--deberta-v3-base/snapshots/*/") + \
             glob.glob(str(pathlib.Path.home() / ".cache/huggingface/hub/models--microsoft--deberta-v3-base/snapshots/*/")):
    p = pathlib.Path(snap) / "tokenizer_config.json"
    if p.is_file():
        try:
            cfg = json.loads(p.read_text())
        except Exception:
            cfg = {}
    else:
        cfg = {}
    cfg["tokenizer_class"] = "DebertaV2Tokenizer"
    cfg.setdefault("do_lower_case", False)
    cfg.setdefault("vocab_type", "spm")
    p.write_text(json.dumps(cfg))
    print("patched", p)
PYFIX
