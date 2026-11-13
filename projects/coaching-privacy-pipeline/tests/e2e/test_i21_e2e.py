"""I21 RED: JSON/CSV batch unreachable from the CLI; partial outputs on failure (issue #21)."""
from __future__ import annotations

import json
import pathlib
import subprocess
import sys

import pytest

pytestmark = pytest.mark.slow

REPO = pathlib.Path(__file__).resolve().parents[2]
CLI = [sys.executable, "-m", "coaching_privacy.cli"]

TRANSCRIPT_A = {
    "schema_version": "1.0", "session_id": "i21-a", "source_type": "synthetic_text",
    "purpose": "internal_coaching_analysis", "language": "en",
    "speakers": [{"id": "S1", "role": "COACH"}, {"id": "S2", "role": "CLIENT"}],
    "utterances": [
        {"id": "u1", "speaker_id": "S2", "start_ms": None, "end_ms": None,
         "text": "I want to lead my team better."},
    ],
    "metadata": {"synthetic": True},
}


def _run(args, cwd=REPO):
    return subprocess.run(
        CLI + args, capture_output=True, text=True, cwd=cwd
    )


def test_json_array_batch_end_to_end(tmp_path):
    batch = tmp_path / "batch.json"
    batch.write_text(json.dumps([TRANSCRIPT_A]))
    out = tmp_path / "out"
    r = _run(["process", "--input", str(batch), "--policy",
              "internal_coaching_analysis", "--output", str(out)])
    assert r.returncode == 0, r.stderr
    assert (out / "i21-a" / "decision.json").is_file()
    assert (out / "i21-a" / "sanitized.json").is_file()
    assert (out / "i21-a" / "validation_report.json").is_file()


def test_csv_batch_end_to_end(tmp_path):
    csv_content = (
        "session_id,turn_index,speaker_role,utterance\n"
        'i21-c,1,CLIENT,"I want clearer boundaries."\n'
    )
    batch = tmp_path / "batch.csv"
    batch.write_text(csv_content)
    out = tmp_path / "out"
    r = _run(["process", "--input", str(batch), "--policy",
              "internal_coaching_analysis", "--output", str(out)])
    assert r.returncode == 0, r.stderr
    assert (out / "i21-c" / "decision.json").is_file()


def test_malformed_record_leaves_no_partial_outputs(tmp_path):
    good = dict(TRANSCRIPT_A)
    bad = {"transcript": {"session_id": "i21-b", "not": "a transcript"}}
    batch = tmp_path / "batch.json"
    batch.write_text(json.dumps([good, bad]))
    out = tmp_path / "out"
    r = _run(["process", "--input", str(batch), "--policy",
              "internal_coaching_analysis", "--output", str(out)])
    assert r.returncode == 2, (r.returncode, r.stdout, r.stderr)
    session_dirs = [d for d in out.iterdir() if d.is_dir()] if out.is_dir() else []
    assert session_dirs == [], f"partial outputs left behind: {session_dirs}"


def test_jsonl_behavior_unchanged(tmp_path):
    fixture = REPO / "fixtures" / "seed_fixtures.jsonl"
    out = tmp_path / "out"
    r = _run(["process", "--input", str(fixture), "--policy",
              "internal_coaching_analysis", "--output", str(out)])
    assert r.returncode == 0, r.stderr
    assert (out / "fictional-S01" / "decision.json").is_file()
