#!/usr/bin/env bash
# Install Python .venv, pinned dependencies, spaCy en_core_web_sm (real Presidio
# backend) and the pinned GLiNER Medium v2.1 checkpoint (downloaded once during
# controlled setup; runtime is fully offline). Safe from any cwd. Exit nonzero
# on mandatory failures.
set -euo pipefail
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_DIR"
python3 -m venv .venv
.venv/bin/pip install --quiet --upgrade pip
.venv/bin/pip install --quiet "spacy>=3.7,<3.9" "presidio-analyzer" "presidio-anonymizer" "pydantic" "pyyaml" "pytest"
# S3+: real GLiNER Medium v2.1 offline inference (CPU)
.venv/bin/pip install --quiet "gliner==0.2.30" "transformers==4.57.6" "sentencepiece" "protobuf" "tiktoken"
# S5: real offline ASR (faster-whisper tiny.en, CPU int8) — versions pinned
.venv/bin/pip install --quiet "faster-whisper==1.2.1" "ctranslate2==4.9.0"
.venv/bin/pip install --quiet -e .

# spaCy NER backend for Presidio — wheel version pinned (issue #18)
.venv/bin/pip install --quiet "en_core_web_sm@https://github.com/explosion/spacy-models/releases/download/en_core_web_sm-3.8.0/en_core_web_sm-3.8.0-py3-none-any.whl"
if ! .venv/bin/python -c "import spacy; spacy.load('en_core_web_sm')" 2>/dev/null; then
  .venv/bin/python -m spacy download en_core_web_sm
  .venv/bin/pip install --quiet "en_core_web_sm==3.8.0" 2>/dev/null || true
fi

# GLiNER checkpoint + backbone tokenizer: download once during controlled setup.
# Large-asset downloads can fail transiently on runners -> retry up to 3 times.
download_models() {
  .venv/bin/python - <<'PYSETUP'
from huggingface_hub import snapshot_download
# Revision-pinned downloads (issue #18): exact commit SHAs recorded in
# scripts/model_manifest.json; sha256 enforced by scripts/verify_models.py.
snapshot_download(repo_id="urchade/gliner_medium-v2.1",
                  revision="40ec419335d09393f298636f471328b722c6da9e",
                  local_dir="models/gliner_medium-v2.1",
                  allow_patterns=["*.json", "*.safetensors", "*.txt", "*.md"])
tok_dir = snapshot_download(repo_id="microsoft/deberta-v3-base",
                  revision="8ccc9b6f36199bec6961081d44eb72fb3f7353f3",
                  allow_patterns=["tokenizer_config.json", "spm.model",
                                  "special_tokens_map.json", "added_tokens.json",
                                  "config.json"])
# A revision-pinned snapshot_download does NOT write refs/main, but
# transformers' offline resolution of the backbone ('microsoft/deberta-v3-base')
# requires that ref to find the snapshot. Point refs/main at the exact pinned
# commit (no drift: it is the same revision downloaded above).
import pathlib
ref_dir = pathlib.Path.home() / ".cache/huggingface/hub/models--microsoft--deberta-v3-base/refs"
ref_dir.mkdir(parents=True, exist_ok=True)
(ref_dir / "main").write_text("8ccc9b6f36199bec6961081d44eb72fb3f7353f3")
print("backbone ref pinned to 8ccc9b6f36199bec6961081d44eb72fb3f7353f3")
# Make the checkpoint dir fully self-contained (vendored backbone tokenizer)
import shutil, pathlib
for f in ("spm.model", "tokenizer_config.json", "config.json"):
    src = pathlib.Path(tok_dir) / f
    dst = pathlib.Path("models/gliner_medium-v2.1") / f
    if src.is_file() and not dst.is_file():
        shutil.copy(src, dst)
print("models ready; backbone tokenizer vendored")
PYSETUP
}

if [ ! -f models/gliner_medium-v2.1/model.safetensors ]; then
  for attempt in 1 2 3; do
    echo "model download attempt ${attempt}/3"
    if download_models; then
      break
    fi
    if [ "$attempt" = "3" ]; then
      echo "ERROR: model download failed after 3 attempts" >&2
      exit 1
    fi
    sleep 10
  done
fi

# S5: pre-fetch the pinned Whisper tiny.en model during controlled setup
# (the ASR adapter hard-blocks network at runtime; model must be local first).
# Revision-pinned (issue #18); refs/main written so offline resolution works.
.venv/bin/python - <<'PYASR'
from huggingface_hub import snapshot_download
import pathlib
WHISPER_REV = "0d3d19a32d3338f10357c0889762bd8d64bbdeba"
snapshot_download(repo_id="Systran/faster-whisper-tiny.en",
                  revision=WHISPER_REV,
                  cache_dir="models/whisper-tiny.en",
                  allow_patterns=["model.bin", "config.json", "tokenizer.json",
                                  "vocabulary.txt"])
base = pathlib.Path("models/whisper-tiny.en/models--Systran--faster-whisper-tiny.en")
(base / "refs").mkdir(parents=True, exist_ok=True)
(base / "refs" / "main").write_text(WHISPER_REV)
from faster_whisper import WhisperModel
m = WhisperModel("tiny.en", device="cpu", compute_type="int8",
                 download_root="models/whisper-tiny.en")
print("whisper tiny.en ready at pinned revision (local cache: models/whisper-tiny.en)")
PYASR

# I13-S2: pre-fetch the selectable base.en model (pinned + verified) so
# COACHING_WHISPER_MODEL=base.en works offline. Default remains tiny.en.
.venv/bin/python - <<'PYASRBASE'
from huggingface_hub import snapshot_download
import pathlib
BASE_REV = "3d3d5dee26484f91867d81cb899cfcf72b96be6c"
snapshot_download(repo_id="Systran/faster-whisper-base.en",
                  revision=BASE_REV,
                  cache_dir="models/whisper-base.en",
                  allow_patterns=["model.bin", "config.json", "tokenizer.json",
                                  "vocabulary.txt"])
base = pathlib.Path("models/whisper-base.en/models--Systran--faster-whisper-base.en")
(base / "refs").mkdir(parents=True, exist_ok=True)
(base / "refs" / "main").write_text(BASE_REV)
print("whisper base.en prefetched at pinned revision")
PYASRBASE

# Vendor the patched tokenizer_config into the checkpoint dir and hash it:
# the manifest pins the *vendored, patched* file (issue #18) — no in-place
# HF-cache mutation that a re-download could silently revert.
.venv/bin/python - <<'PYFIX'
import json, pathlib
# Vendored+patched tokenizer_config lives inside the checkpoint dir; the
# manifest pins its hash. Only patch when the content is not already correct
# (idempotent on re-runs, and works even if the HF cache was cleared).
dst = pathlib.Path("models/gliner_medium-v2.1/tokenizer_config.json")
desired = {"do_lower_case": False, "vocab_type": "spm",
           "tokenizer_class": "DebertaV2Tokenizer"}
if dst.is_file():
    try:
        cfg = json.loads(dst.read_text())
    except Exception:
        cfg = {}
else:
    tok_src = pathlib.Path.home() / ".cache/huggingface/hub/models--microsoft--deberta-v3-base"
    snaps = sorted(tok_src.glob("snapshots/*/tokenizer_config.json"))
    assert snaps, "deberta-v3-base tokenizer_config not found after download"
    cfg = json.loads(snaps[0].read_text())
cfg["tokenizer_class"] = "DebertaV2Tokenizer"
cfg.setdefault("do_lower_case", False)
cfg.setdefault("vocab_type", "spm")
dst.write_text(json.dumps(cfg))
print("vendored patched tokenizer_config into", dst)
PYFIX

# Issue #18: fail closed if any manifest-listed model file is missing or its
# sha256 does not match scripts/model_manifest.json.
.venv/bin/python scripts/verify_models.py

.venv/bin/python - <<'PY'
from presidio_analyzer import AnalyzerEngine
import spacy
a = AnalyzerEngine()
assert a is not None
spacy.load("en_core_web_sm")
print("setup OK: presidio analyzer ready; spacy", spacy.__version__, "en_core_web_sm loaded")
PY
