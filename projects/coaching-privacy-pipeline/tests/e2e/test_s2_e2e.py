"""S2 E2E: same transcript processed under two purposes yields different outputs (A08/A09/A17)."""
import json
import pytest
import pathlib
import subprocess

pytestmark = pytest.mark.slow

PROJECT = pathlib.Path(__file__).resolve().parents[2]
VENV_BIN = PROJECT / ".venv" / "bin"


def _write_purpose_fixture(tmp_path, purpose):
    data = {
        "fixture_id": "s2-e2e", "fixture_version": "1.0",
        "subject_id": "P-e2e", "scenario_family": "third_party",
        "gold_spans": [], "gold_context_risk_codes": [],
        "prohibited_leaks": ["Alden"],
        "required_preservation_facts": ["client feels frustrated by rescheduled one-to-ones"],
        "expected_baseline_decision": "REVIEW_REQUIRED",
        "note": "synthetic e2e fixture",
        "transcript": {
            "schema_version": "1.0", "session_id": "s2-e2e",
            "source_type": "synthetic_text", "purpose": purpose, "language": "en",
            "speakers": [{"id": "S1", "role": "COACH"}, {"id": "S2", "role": "CLIENT"}],
            "utterances": [
                {"id": "u1", "speaker_id": "S1", "start_ms": None, "end_ms": None,
                 "text": "Who is putting pressure on you?"},
                {"id": "u2", "speaker_id": "S2", "start_ms": None, "end_ms": None,
                 "text": "My manager, Mr. Alden, keeps rescheduling our one-to-ones, and I feel frustrated."},
            ],
            "metadata": {"synthetic": True},
        },
    }
    p = tmp_path / f"in_{purpose}.jsonl"
    p.write_text(json.dumps(data) + "\n")
    return p


def test_same_transcript_two_purposes_differ(tmp_path):
    results = {}
    for purpose in ("internal_coaching_analysis", "external_sharing"):
        inp = _write_purpose_fixture(tmp_path, purpose)
        out = tmp_path / f"out_{purpose}"
        r = subprocess.run(
            [str(VENV_BIN / "privacy-pipeline"), "process",
             "--input", str(inp), "--policy", purpose, "--output", str(out)],
            capture_output=True, text=True,
        )
        assert r.returncode == 0, r.stderr
        decision = json.loads((out / "s2-e2e" / "decision.json").read_text())
        sanitized = json.loads((out / "s2-e2e" / "sanitized.json").read_text())
        results[purpose] = (decision["decision"], sanitized)
        assert "Alden" not in json.dumps(sanitized)

    internal_dec, internal_san = results["internal_coaching_analysis"]
    external_dec, external_san = results["external_sharing"]
    # External sharing always requires human release (A17)
    assert external_dec == "REVIEW_REQUIRED"
    # Meaning-relevant experience preserved for internal purpose (A09)
    internal_text = " ".join(u["text"] for u in internal_san["utterances"])
    assert "rescheduling" in internal_text or "one-to-ones" in internal_text
    # Turn structure preserved in both (A08)
    for _, san in results.values():
        assert [u["id"] for u in san["utterances"]] == ["u1", "u2"]
        assert [u["speaker_id"] for u in san["utterances"]] == ["S1", "S2"]


def test_external_output_never_auto_released_even_when_clean(tmp_path):
    inp = _write_purpose_fixture(tmp_path, "external_sharing")
    out = tmp_path / "out_ext"
    r = subprocess.run(
        [str(VENV_BIN / "privacy-pipeline"), "process",
         "--input", str(inp), "--policy", "external_sharing", "--output", str(out)],
        capture_output=True, text=True,
    )
    assert r.returncode == 0
    decision = json.loads((out / "s2-e2e" / "decision.json").read_text())
    assert decision["decision"] == "REVIEW_REQUIRED"
    assert "human" in " ".join(decision["review_reasons"]).lower() or \
        "external" in " ".join(decision["review_reasons"]).lower()
