"""I23-S2 RED: batch CLI runs never run cross-session linkage (issue #23 slice 2).

Two grouped sessions whose clue sets combine must both route to
REVIEW_REQUIRED with MULTI_SESSION_LINK, produced by the CLI batch run.
"""
from __future__ import annotations

import json
import pathlib
import subprocess
import sys

import pytest

pytestmark = pytest.mark.slow

REPO = pathlib.Path(__file__).resolve().parents[2]
CLI = [sys.executable, "-m", "coaching_privacy.cli"]


def _session(sid: str, subject_ref: str, utterance: str, purpose="internal_coaching_analysis") -> dict:
    return {
        "schema_version": "1.0", "session_id": sid, "source_type": "synthetic_text",
        "purpose": purpose, "language": "en",
        "speakers": [{"id": "S1", "role": "COACH"}, {"id": "S2", "role": "CLIENT"}],
        "utterances": [
            {"id": "u1", "speaker_id": "S2", "start_ms": None, "end_ms": None,
             "text": utterance},
        ],
        "metadata": {"synthetic": True, "subject_ref": subject_ref},
    }


LINK_BATCH = [
    _session("link-a", "P-100", "I am the Head of Cartography at Marlowe Systems."),
    _session("link-b", "P-100", "Our office sits in the harbor district of Duncastle."),
]
UNLINKED_BATCH = [
    _session("un-a", "P-201", "I am the Head of Cartography at Marlowe Systems."),
    _session("un-b", "P-202", "Our office sits in the harbor district of Duncastle."),
]


def _run(batch, tmp_path, extra=None):
    inp = tmp_path / "batch.json"
    inp.write_text(json.dumps(batch))
    out = tmp_path / "out"
    args = CLI + ["process", "--input", str(inp), "--policy",
                  "internal_coaching_analysis", "--output", str(out),
                  "--link-group-key", "subject_ref"]
    r = subprocess.run(args + (extra or []), capture_output=True, text=True, cwd=REPO)
    return r, out


def test_linked_group_sessions_route_to_review(tmp_path):
    r, out = _run(LINK_BATCH, tmp_path)
    assert r.returncode == 0, (r.stdout, r.stderr)
    for sid in ("link-a", "link-b"):
        decision = json.loads((out / sid / "decision.json").read_text())
        assert decision["decision"] == "REVIEW_REQUIRED", decision
        assert "MULTI_SESSION_LINK" in " ".join(decision.get("review_reasons", [])), decision
    report = json.loads((out / "link-a" / "validation_report.json").read_text())
    csr = report["cross_session_risks"]
    assert any(r_["code"] == "MULTI_SESSION_LINK" for r_ in csr), csr
    assert (out / "batch_linkage_report.json").is_file()


def test_unrelated_sessions_stay_unlinked(tmp_path):
    r, out = _run(UNLINKED_BATCH, tmp_path)
    assert r.returncode == 0, (r.stdout, r.stderr)
    for sid in ("un-a", "un-b"):
        decision = json.loads((out / sid / "decision.json").read_text())
        # linkage must not touch unrelated sessions: whatever the single-session
        # baseline decision was, MULTI_SESSION_LINK must be absent
        assert "MULTI_SESSION_LINK" not in decision.get("review_reasons", []), decision
    report = json.loads((out / "un-a" / "validation_report.json").read_text())
    assert report["cross_session_risks"] == [], report["cross_session_risks"]


def test_missing_group_key_not_assessed_not_clean(tmp_path):
    inp = tmp_path / "batch.json"
    inp.write_text(json.dumps(LINK_BATCH))
    out = tmp_path / "out"
    r = subprocess.run(
        CLI + ["process", "--input", str(inp), "--policy",
               "internal_coaching_analysis", "--output", str(out)],
        capture_output=True, text=True, cwd=REPO,
    )
    assert r.returncode == 0, r.stderr
    report = json.loads((out / "link-a" / "validation_report.json").read_text())
    csr = report["cross_session_risks"]
    assert isinstance(csr, dict) and csr.get("status") == "NOT_ASSESSED_NO_GROUP_KEY", csr
