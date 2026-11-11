"""S2 negative tests: meaning-changing transform is flagged, never silently released."""
import sys
import pathlib

PROJECT = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(PROJECT / "src"))


def test_mutant_transcript_sent_to_review_or_blocked():
    from coaching_privacy.fidelity import SemanticFidelityChecker

    checker = SemanticFidelityChecker()
    # A transform that invents facts / changes client sentiment
    result = checker.check(
        required_facts=["client feels frustrated by rescheduled one-to-ones"],
        sanitized_text="The client loves every meeting and has no concerns at all.",
    )
    assert result["decision_impact"] in {"REVIEW_REQUIRED", "BLOCKED"}


def test_missing_required_fact_is_not_silent_pass():
    from coaching_privacy.fidelity import SemanticFidelityChecker

    checker = SemanticFidelityChecker()
    result = checker.check(
        required_facts=["client wants clearer boundaries"],
        sanitized_text="We talked about the weather.",
    )
    # Required fact absent -> cannot be an OK pass
    assert result["status"] != "OK"
