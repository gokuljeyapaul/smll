"""S7 E2E: batch directory input -> per-session results, same fail-closed guarantees (A19)."""
import json
import pytest
import pathlib
import subprocess

pytestmark = pytest.mark.slow

PROJECT = pathlib.Path(__file__).resolve().parents[2]
VENV_BIN = PROJECT / ".venv" / "bin"


def _transcript(session_id):
    return {
        "fixture_id": f"b-{session_id}", "fixture_version": "1.0",
        "subject_id": "P-s7", "scenario_family": "benign_control",
        "gold_spans": [], "gold_context_risk_codes": [],
        "prohibited_leaks": [], "required_preservation_facts": [],
        "expected_baseline_decision": "RELEASE_CANDIDATE", "note": "synthetic",
        "transcript": {
            "schema_version": "1.0", "session_id": session_id,
            "source_type": "synthetic_text",
            "purpose": "internal_coaching_analysis", "language": "en",
            "speakers": [{"id": "S1", "role": "COACH"}, {"id": "S2", "role": "CLIENT"}],
            "utterances": [
                {"id": "u1", "speaker_id": "S2", "start_ms": None,
                 "end_ms": None, "text": "I finished a report early and helped a teammate."},
            ],
            "metadata": {"synthetic": True},
        },
    }


def test_batch_directory_e2e(tmp_path):
    inp = tmp_path / "batch.jsonl"
    inp.write_text(json.dumps(_transcript("b-1")) + "\n"
                   + json.dumps(_transcript("b-2")) + "\n")
    out = tmp_path / "out"
    r = subprocess.run(
        [str(VENV_BIN / "privacy-pipeline"), "process",
         "--input", str(inp), "--policy", "internal_coaching_analysis",
         "--output", str(out)],
        capture_output=True, text=True,
    )
    assert r.returncode == 0, r.stderr
    for sid in ("b-1", "b-2"):
        d = json.loads((out / sid / "decision.json").read_text())
        assert d["decision"] in {"RELEASE_CANDIDATE", "REVIEW_REQUIRED"}
        assert (out / sid / "sanitized.json").is_file()
        assert (out / sid / "validation_report.json").is_file()


def test_batch_with_one_bad_session_fails_that_session_not_others(tmp_path):
    good = _transcript("g-1")
    bad = {"garbage": "not a transcript"}
    inp = tmp_path / "mixed.jsonl"
    inp.write_text(json.dumps(good) + "\n" + json.dumps(bad) + "\n")
    out = tmp_path / "out_mixed"
    r = subprocess.run(
        [str(VENV_BIN / "privacy-pipeline"), "process",
         "--input", str(inp), "--policy", "internal_coaching_analysis",
         "--output", str(out)],
        capture_output=True, text=True,
    )
    # batch must fail closed on the malformed record: exit 2 exactly, and
    # no partial session outputs may remain (I21 all-or-nothing)
    assert r.returncode == 2, (r.returncode, r.stdout, r.stderr)
    session_dirs = [d for d in out_mixed_or_created(out)]
    assert session_dirs == [], f"partial outputs left behind: {session_dirs}"


def out_mixed_or_created(out):
    return out.iterdir() if out.is_dir() else []
