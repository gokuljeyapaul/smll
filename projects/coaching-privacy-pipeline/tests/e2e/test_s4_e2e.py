"""S4 E2E: two linkable sessions -> combined release reviewed/blocked; four decision states demo (A11, A17, A18)."""
import json
import pytest
import pathlib
import subprocess
import sys

pytestmark = pytest.mark.slow

PROJECT = pathlib.Path(__file__).resolve().parents[2]
VENV_BIN = PROJECT / ".venv" / "bin"
sys.path.insert(0, str(PROJECT / "src"))


def _session(session_id, utterances):
    return {
        "fixture_id": f"s4-{session_id}", "fixture_version": "1.0",
        "subject_id": "P-s4", "scenario_family": "multi_session_link",
        "gold_spans": [], "gold_context_risk_codes": [],
        "prohibited_leaks": [], "required_preservation_facts": [],
        "expected_baseline_decision": "REVIEW_REQUIRED", "note": "synthetic",
        "transcript": {
            "schema_version": "1.0", "session_id": session_id,
            "source_type": "synthetic_text",
            "purpose": "internal_coaching_analysis", "language": "en",
            "speakers": [{"id": "S1", "role": "COACH"}, {"id": "S2", "role": "CLIENT"}],
            "utterances": utterances, "metadata": {"synthetic": True},
        },
    }


def _utt(i, speaker, text):
    return {"id": f"u{i}", "speaker_id": speaker, "start_ms": None,
            "end_ms": None, "text": text}


def test_linked_sessions_combined_risk_e2e(tmp_path):
    # Session A: rare role only; Session B: location + achievement (same persona path)
    a = _session("s4-A", [_utt(1, "S2", "Years ago I worked as a Director of Lunar Logistics before moving into coaching.")])
    b = _session("s4-B", [_utt(1, "S2", "I live near Sylvar City and won the Lantern Award last April.")])
    inp = tmp_path / "linked.jsonl"
    inp.write_text(json.dumps(a) + "\n" + json.dumps(b) + "\n")
    out = tmp_path / "out"
    r = subprocess.run(
        [str(VENV_BIN / "privacy-pipeline"), "process",
         "--input", str(inp), "--policy", "internal_coaching_analysis",
         "--output", str(out)],
        capture_output=True, text=True,
    )
    assert r.returncode == 0, r.stderr
    # run the cross-session assessment over both processed sessions
    from coaching_privacy.linkage import CrossSessionLinker, ReleaseGate
    reports = {}
    for sid in ("s4-A", "s4-B"):
        reports[sid] = json.loads((out / sid / "validation_report.json").read_text())
    entities = {}
    for sid, rep in reports.items():
        spans = []
        for utt_id, span_list in rep.get("context_spans", {}).items():
            spans.extend(span_list)
        entities[sid] = spans
    risks = CrossSessionLinker().assess_sessions(entities)
    assert risks, "linked sessions produced no cross-session risk"
    gate = ReleaseGate()
    decisions = {
        sid: json.loads((out / sid / "decision.json").read_text())["decision"]
        for sid in reports
    }
    combined = gate.gate(per_session_decisions=decisions, linkage_risks=risks)
    assert combined in {"REVIEW_REQUIRED", "BLOCKED"}


def test_benign_unrelated_sessions_usable(tmp_path):
    a = _session("s4-C", [_utt(1, "S2", "I finished a report early and helped a teammate.")])
    b = _session("s4-D", [_utt(1, "S2", "I enjoyed the team offsite this week.")])
    inp = tmp_path / "benign.jsonl"
    inp.write_text(json.dumps(a) + "\n" + json.dumps(b) + "\n")
    out = tmp_path / "out_b"
    r = subprocess.run(
        [str(VENV_BIN / "privacy-pipeline"), "process",
         "--input", str(inp), "--policy", "internal_coaching_analysis",
         "--output", str(out)],
        capture_output=True, text=True,
    )
    assert r.returncode == 0, r.stderr
    for sid in ("s4-C", "s4-D"):
        d = json.loads((out / sid / "decision.json").read_text())["decision"]
        assert d in {"RELEASE_CANDIDATE", "REVIEW_REQUIRED"}
