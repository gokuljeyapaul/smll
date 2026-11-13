"""I13-S1 RED: ASR benchmark tooling absent (issue #13 slice 1).

Running scripts/bench_asr.py via subprocess must yield a JSON report with
per-model WER/CER/runtime for at least 2 models over a seeded fixture set.
"""
from __future__ import annotations

import json
import pathlib
import subprocess
import sys

import pytest

pytestmark = pytest.mark.slow

REPO = pathlib.Path(__file__).resolve().parents[2]


def test_bench_asr_produces_multi_model_report(tmp_path):
    bench = REPO / "scripts" / "bench_asr.py"
    out = tmp_path / "bench_report.json"
    r = subprocess.run(
        [sys.executable, str(bench), "--output", str(out),
         "--models", "tiny.en", "base.en"],
        capture_output=True, text=True, cwd=REPO, timeout=1500,
    )
    assert r.returncode == 0, (r.stdout, r.stderr)
    report = json.loads(out.read_text())
    models = {entry["model"] for entry in report["results"]}
    assert {"tiny.en", "base.en"} <= models, report
    for entry in report["results"]:
        assert isinstance(entry.get("wer"), float), entry
        assert isinstance(entry.get("cer"), float), entry
        assert entry.get("runtime_s", 0) > 0, entry
        assert entry.get("utterances", 0) >= 5, entry
    assert "fixture_note" in report  # synthetic-speech caveat stated


def test_bench_fixture_set_has_reference_texts():
    """The seeded espeak fixture set (>= 30 utterances) exists with refs."""
    refs = REPO / "fixtures" / "audio" / "bench_references.json"
    assert refs.is_file(), "benchmark fixture set missing"
    data = json.loads(refs.read_text())
    assert len(data) >= 30, len(data)
    for item in data:
        assert isinstance(item.get("wav"), str) and isinstance(item.get("text"), str)
        assert (REPO / "fixtures" / "audio" / item["wav"]).is_file()
