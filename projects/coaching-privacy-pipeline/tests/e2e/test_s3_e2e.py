"""S3 E2E: transcript with cross-turn clues -> GLiNER -> risk rules -> review decision (A10)."""
import json
import pytest
import pathlib
import subprocess
import sys

pytestmark = pytest.mark.slow

PROJECT = pathlib.Path(__file__).resolve().parents[2]
VENV_BIN = PROJECT / ".venv" / "bin"


def _write_fixture(tmp_path):
    data = {
        "fixture_id": "s3-e2e", "fixture_version": "1.0",
        "subject_id": "P-s3", "scenario_family": "multi_turn_link",
        "gold_spans": [], "gold_context_risk_codes": ["COMBINATION_OF_CLUES"],
        "prohibited_leaks": [],
        "required_preservation_facts": ["client leads a small team"],
        "expected_baseline_decision": "REVIEW_REQUIRED",
        "note": "synthetic e2e fixture",
        "transcript": {
            "schema_version": "1.0", "session_id": "s3-e2e",
            "source_type": "synthetic_text",
            "purpose": "internal_coaching_analysis", "language": "en",
            "speakers": [{"id": "S1", "role": "COACH"}, {"id": "S2", "role": "CLIENT"}],
            "utterances": [
                {"id": "u1", "speaker_id": "S1", "start_ms": None, "end_ms": None,
                 "text": "Tell me about your work."},
                {"id": "u2", "speaker_id": "S2", "start_ms": None, "end_ms": None,
                 "text": "I lead a small team at Auricwood Labs."},
                {"id": "u3", "speaker_id": "S1", "start_ms": None, "end_ms": None,
                 "text": "Where is the team based?"},
                {"id": "u4", "speaker_id": "S2", "start_ms": None, "end_ms": None,
                 "text": "Near Sylvar City."},
                {"id": "u5", "speaker_id": "S1", "start_ms": None, "end_ms": None,
                 "text": "Anything you are proud of this year?"},
                {"id": "u6", "speaker_id": "S2", "start_ms": None, "end_ms": None,
                 "text": "I won the unusual Lantern Award in April."},
            ],
            "metadata": {"synthetic": True},
        },
    }
    p = tmp_path / "s3.jsonl"
    p.write_text(json.dumps(data) + "\n")
    return p


def test_cross_turn_combination_routes_to_review(tmp_path):
    inp = _write_fixture(tmp_path)
    out = tmp_path / "out"
    r = subprocess.run(
        [str(VENV_BIN / "privacy-pipeline"), "process",
         "--input", str(inp), "--policy", "internal_coaching_analysis",
         "--output", str(out)],
        capture_output=True, text=True,
    )
    assert r.returncode == 0, r.stderr
    report = json.loads((out / "s3-e2e" / "validation_report.json").read_text())
    decision = json.loads((out / "s3-e2e" / "decision.json").read_text())
    # The composite clue must be visible in the report
    assert report["context_risks"], "no context risks recorded"
    assert any("COMBINATION" in json.dumps(cr) for cr in report["context_risks"])
    # And the decision must be review, not release
    assert decision["decision"] in {"REVIEW_REQUIRED", "BLOCKED"}


def test_gliner_unavailable_fails_closed(tmp_path):
    """A pipeline run with a broken GLiNER path must fail closed (FAILED),
    never silently skip contextual detection."""
    inp = _write_fixture(tmp_path)
    out = tmp_path / "out_fail"
    env = {"PATH": "/usr/bin:/bin", "COACHING_GLINER_PATH": "/nonexistent/model",
           "HOME": str(tmp_path)}
    r = subprocess.run(
        [str(VENV_BIN / "privacy-pipeline"), "process",
         "--input", str(inp), "--policy", "internal_coaching_analysis",
         "--output", str(out)],
        capture_output=True, text=True, env=env,
    )
    # Either FAILED decision recorded or nonzero exit — never a silent success
    decision_file = out / "s3-e2e" / "decision.json"
    if r.returncode == 0:
        decision = json.loads(decision_file.read_text())
        assert decision["decision"] == "FAILED"
