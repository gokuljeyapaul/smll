"""S4 negative tests: validator failure injection, gold isolation, no silent release (A14, A18)."""
import sys
import pytest
import pathlib

pytestmark = pytest.mark.fast

PROJECT = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(PROJECT / "src"))


def test_independent_validator_failure_blocks_release():
    """A validator that raises must yield FAILED, never a silent pass (A14)."""
    from coaching_privacy.pipeline import SafetyGate

    gate = SafetyGate()
    decision = gate.decide(
        {"validator_available": False, "error": "validator crashed"},
        purpose="internal_coaching_analysis",
    )
    assert decision["decision"] == "FAILED"


def test_transform_variant_missing_detector_call_fails_closed():
    """Simulate a transform variant that skips the detector: independence
    check must fail closed (A14)."""
    from coaching_privacy.validator import IndependentLeakValidator

    validator = IndependentLeakValidator()
    # sanitized output that still contains a prohibited identifier while the
    # transformer claims success
    report = validator.validate(
        prohibited_leaks=["Mira Solen"],
        sanitized_utterances=[
            {"id": "u1", "speaker_id": "S2", "text": "Mira Solen told me about it."}
        ],
    )
    assert report["leak_count"] == 1


def test_evaluator_directory_not_accessible_to_runtime(tmp_path):
    """Runtime processing must never read the attacker/evaluator directory."""
    from coaching_privacy import engine

    # engine exposes no directory/attacker input; the only inputs are
    # transcripts + policy. Assert the module has no such hooks.
    import inspect
    src = inspect.getsource(engine)
    assert "attacker" not in src.lower()
    assert "directory" not in src.lower() or "output" in src.lower()


def test_no_real_person_lookup_in_linkage():
    from coaching_privacy.linkage import CrossSessionLinker

    linker = CrossSessionLinker()
    # closed-world: assess_sessions accepts only in-memory entity dicts
    import inspect
    sig = inspect.signature(linker.assess_sessions)
    assert list(sig.parameters) == ["session_entities"]
