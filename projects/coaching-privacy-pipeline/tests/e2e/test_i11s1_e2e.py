"""I11-S1 RED: unsupported language aborts the whole CLI run (issue #11 slice 1).

A well-formed but unsupported (e.g. de) session must process per-session:
exit 0, decision REVIEW_REQUIRED with unsupported_language, sanitized output
empty, and zero detector calls (gate short-circuits before detection).
Malformed/missing language must still be a ContractError.
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


def _record(sid: str, language, text="Ich möchte mein Team besser führen.") -> dict:
    return {
        "transcript": {
            "schema_version": "1.0", "session_id": sid,
            "source_type": "synthetic_text",
            "purpose": "internal_coaching_analysis", "language": language,
            "speakers": [{"id": "S1", "role": "COACH"}, {"id": "S2", "role": "CLIENT"}],
            "utterances": [
                {"id": "u1", "speaker_id": "S2", "start_ms": None, "end_ms": None,
                 "text": text},
            ],
            "metadata": {"synthetic": True},
        },
        "prohibited_leaks": [],
    }


def _run(records, tmp_path):
    inp = tmp_path / "batch.jsonl"
    inp.write_text("\n".join(json.dumps(r) for r in records) + "\n")
    out = tmp_path / "out"
    r = subprocess.run(
        CLI + ["process", "--input", str(inp), "--policy",
               "internal_coaching_analysis", "--output", str(out)],
        capture_output=True, text=True, cwd=REPO,
    )
    return r, out


def test_german_session_review_not_abort(tmp_path):
    r, out = _run([_record("de-1", "de")], tmp_path)
    assert r.returncode == 0, (r.returncode, r.stdout, r.stderr)
    decision = json.loads((out / "de-1" / "decision.json").read_text())
    assert decision["decision"] == "REVIEW_REQUIRED", decision
    assert "unsupported_language" in decision.get("review_reasons", []), decision
    sanitized = json.loads((out / "de-1" / "sanitized.json").read_text())
    assert sanitized.get("utterances", []) == [], sanitized
    report = json.loads((out / "de-1" / "validation_report.json").read_text())
    lg = report.get("language_gate") or {}
    assert lg.get("status") == "UNSUPPORTED", lg


def test_german_session_does_not_abort_english_batch(tmp_path):
    records = [_record("en-1", "en", "I want to lead my team better."),
               _record("de-1", "de")]
    r, out = _run(records, tmp_path)
    assert r.returncode == 0, (r.returncode, r.stdout, r.stderr)
    en = json.loads((out / "en-1" / "decision.json").read_text())
    de = json.loads((out / "de-1" / "decision.json").read_text())
    assert en["decision"] in {"RELEASE_CANDIDATE", "REVIEW_REQUIRED"}
    assert de["decision"] == "REVIEW_REQUIRED"


def test_missing_language_still_contract_error(tmp_path):
    r, out = _run([_record("bad-1", None)], tmp_path)
    assert r.returncode == 2, (r.returncode, r.stdout)
    session_dirs = [d for d in out.iterdir() if d.is_dir()] if out.is_dir() else []
    assert session_dirs == []


def test_detector_never_called_for_unsupported_language(tmp_path):
    """The language gate must short-circuit before any English detector."""
    from coaching_privacy.contracts import Transcript
    from coaching_privacy.engine import process_transcript
    from coaching_privacy.policy import PolicyStore

    calls = {"n": 0}

    import coaching_privacy.engine as engine_mod

    class _SpyDetector:
        def detect(self, text):
            calls["n"] += 1
            return []

        def model_versions(self):
            return {}

    orig = engine_mod._get_detector
    engine_mod._get_detector = lambda: _SpyDetector()
    try:
        t = Transcript.parse(_record("de-2", "de")["transcript"])
        policy = PolicyStore(
            REPO / "policies" / "sample_policy.yaml"
        ).get(t.purpose)
        result = process_transcript(t, policy)
        assert calls["n"] == 0, "detector ran for an unsupported language"
        assert result.decision["decision"] == "REVIEW_REQUIRED"
    finally:
        engine_mod._get_detector = orig
