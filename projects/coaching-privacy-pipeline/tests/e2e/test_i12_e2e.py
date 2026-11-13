"""I12 RED: CSV column mapping does not exist (issue #12)."""
from __future__ import annotations

import json
import pathlib
import subprocess
import sys

import pytest

pytestmark = pytest.mark.slow

REPO = pathlib.Path(__file__).resolve().parents[2]
CLI = [sys.executable, "-m", "coaching_privacy.cli"]


def _run(args):
    return subprocess.run(CLI + args, capture_output=True, text=True, cwd=REPO)


WIDE_CSV = (
    "id,coach_1,client_1\n"
    'csv-wide-1,"How can I help?","I feel overwhelmed by my calendar."\n'
)
WIDE_MAP = {
    "format": "wide",
    "session_id": "id",
    "turns": [
        {"column": "coach_1", "role": "COACH"},
        {"column": "client_1", "role": "CLIENT"},
    ],
}


def _write(tmp_path, mapping):
    csv_path = tmp_path / "wide.csv"
    csv_path.write_text(WIDE_CSV)
    map_path = tmp_path / "map.json"
    map_path.write_text(json.dumps(mapping))
    return csv_path, map_path


def test_wide_csv_processes_via_mapping(tmp_path):
    csv_path, map_path = _write(tmp_path, WIDE_MAP)
    out = tmp_path / "out"
    r = _run(["process", "--input", str(csv_path), "--policy",
              "internal_coaching_analysis", "--output", str(out),
              "--csv-column-map", str(map_path)])
    assert r.returncode == 0, (r.stdout, r.stderr)
    assert (out / "csv-wide-1" / "decision.json").is_file()
    sanitized = json.loads((out / "csv-wide-1" / "sanitized.json").read_text())
    assert len(sanitized["utterances"]) == 2
    assert sanitized["utterances"][0]["speaker_id"] == "S1"
    assert sanitized["utterances"][1]["speaker_id"] == "S2"


def test_mapping_missing_mandatory_field_fails_before_rows(tmp_path):
    bad_map = {"format": "long", "session_id": "sid", "turn_index": "n",
               "speaker_role": "who"}  # no utterance
    csv_path = tmp_path / "x.csv"
    csv_path.write_text("sid,n,who,text\n1,0,CLIENT,hi\n")
    map_path = tmp_path / "badmap.json"
    map_path.write_text(json.dumps(bad_map))
    out = tmp_path / "out"
    r = _run(["process", "--input", str(csv_path), "--policy",
              "internal_coaching_analysis", "--output", str(out),
              "--csv-column-map", str(map_path)])
    assert r.returncode == 2, (r.returncode, r.stdout)
    assert "utterance" in (r.stderr + r.stdout), r.stderr + r.stdout
    session_dirs = [d for d in out.iterdir() if d.is_dir()] if out.is_dir() else []
    assert session_dirs == []


def test_mapping_referencing_absent_header_fails(tmp_path):
    map_ = dict(WIDE_MAP)
    map_["turns"] = [{"column": "coach_1", "role": "COACH"},
                     {"column": "nonexistent", "role": "CLIENT"}]
    csv_path, map_path = _write(tmp_path, map_)
    out = tmp_path / "out"
    r = _run(["process", "--input", str(csv_path), "--policy",
              "internal_coaching_analysis", "--output", str(out),
              "--csv-column-map", str(map_path)])
    assert r.returncode == 2
    assert "nonexistent" in (r.stderr + r.stdout)


def test_duplicate_session_rows_in_wide_fail(tmp_path):
    csv_path = tmp_path / "wide.csv"
    csv_path.write_text(
        WIDE_CSV + 'csv-wide-1,"again","dup"\n'
    )
    map_path = tmp_path / "map.json"
    map_path.write_text(json.dumps(WIDE_MAP))
    out = tmp_path / "out"
    r = _run(["process", "--input", str(csv_path), "--policy",
              "internal_coaching_analysis", "--output", str(out),
              "--csv-column-map", str(map_path)])
    assert r.returncode == 2
    assert "csv-wide-1" in (r.stderr + r.stdout)


def test_duplicate_turn_index_in_long_fail(tmp_path):
    csv_path = tmp_path / "long.csv"
    csv_path.write_text(
        "session_id,turn_index,speaker_role,utterance\n"
        's,0,CLIENT,"one"\n'
        's,0,CLIENT,"two"\n'
    )
    out = tmp_path / "out"
    r = _run(["process", "--input", str(csv_path), "--policy",
              "internal_coaching_analysis", "--output", str(out)])
    assert r.returncode == 2
    assert "duplicate" in (r.stderr + r.stdout).lower()


def test_column_map_rejected_for_non_csv(tmp_path):
    map_path = tmp_path / "map.json"
    map_path.write_text(json.dumps(WIDE_MAP))
    inp = tmp_path / "batch.json"
    inp.write_text("[]")
    r = _run(["process", "--input", str(inp), "--policy",
              "internal_coaching_analysis", "--output", str(tmp_path / "o"),
              "--csv-column-map", str(map_path)])
    assert r.returncode == 2
    assert "csv" in (r.stderr + r.stdout).lower()
