"""S0 negative/privacy tests: fail-closed decisions (A07, A15)."""
import json
import pytest
import pathlib

pytestmark = pytest.mark.fast

PROJECT = pathlib.Path(__file__).resolve().parents[2]
FIXTURES = PROJECT / "fixtures"


def _first_fixture():
    line = (FIXTURES / "seed_fixtures.jsonl").read_text().splitlines()[0]
    return json.loads(line)


def test_injected_leak_after_transformation_is_blocked():
    from coaching_privacy.pipeline import SafetyGate
    from coaching_privacy.validator import IndependentLeakValidator
    fixture = _first_fixture()
    # Simulate a faulty transform output that re-inserts the identifier
    sanitized_utterances = [
        {"id": "u1", "speaker_id": "S1", "text": "What would you like to focus on today?"},
        {"id": "u2", "speaker_id": "S2",
         "text": "My name is Mira Solen, and my email is mira.solen@example.test."},
    ]
    validator = IndependentLeakValidator()
    report = validator.validate(
        prohibited_leaks=fixture["prohibited_leaks"],
        sanitized_utterances=sanitized_utterances,
    )
    gate = SafetyGate()
    decision = gate.decide(report, purpose="internal_coaching_analysis")
    assert decision["decision"] == "BLOCKED"
    assert decision["decision"] != "RELEASE_CANDIDATE"


def test_unavailable_validator_fails_closed_as_failed():
    from coaching_privacy.pipeline import SafetyGate
    from coaching_privacy.validator import ValidatorUnavailable
    gate = SafetyGate()
    decision = gate.decide(
        {"validator_available": False, "error": str(ValidatorUnavailable("presidio unavailable"))},
        purpose="internal_coaching_analysis",
    )
    assert decision["decision"] == "FAILED"


def test_external_sharing_never_auto_released():
    from coaching_privacy.pipeline import SafetyGate
    gate = SafetyGate()
    clean_report = {"validator_available": True, "residual_pii": [], "context_risks": []}
    decision = gate.decide(clean_report, purpose="external_sharing")
    assert decision["decision"] == "REVIEW_REQUIRED"


def test_clean_internal_transcript_can_be_release_candidate():
    from coaching_privacy.pipeline import SafetyGate
    gate = SafetyGate()
    clean_report = {
        "validator_available": True,
        "residual_pii": [],
        "context_risks": [],
        "all_mandatory_stages_executed": True,
    }
    decision = gate.decide(clean_report, purpose="internal_coaching_analysis")
    assert decision["decision"] == "RELEASE_CANDIDATE"


def test_validator_logs_do_not_contain_source_pii(tmp_path):
    """Routine reports must not echo raw source transcript/PII (A23-relevant)."""
    from coaching_privacy.validator import IndependentLeakValidator
    fixture = _first_fixture()
    sanitized_utterances = [
        {"id": "u2", "speaker_id": "S2", "text": "My name is Mira Solen."},
    ]
    validator = IndependentLeakValidator()
    report = validator.validate(
        prohibited_leaks=fixture["prohibited_leaks"],
        sanitized_utterances=sanitized_utterances,
    )
    serialized = json.dumps(report, default=str)
    assert "Mira Solen" not in serialized
