"""S3 unit tests: deterministic cross-turn combination rules + benign negatives (A10)."""
import sys
import pathlib

PROJECT = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(PROJECT / "src"))


def test_rare_combination_flagged_across_turns():
    from coaching_privacy.context import RuleBasedContextRiskEngine

    engine = RuleBasedContextRiskEngine()
    entities_by_turn = {
        "u1": [{"label": "QUASI_IDENTIFIER.RARE_ROLE", "value": "Director of Lunar Logistics",
                "start": 14, "end": 41, "confidence": 0.54, "detector": "gliner"}],
        "u2": [{"label": "QUASI_IDENTIFIER.PRECISE_LOCATION", "value": "Sylvar City",
                "start": 5, "end": 16, "confidence": 0.9, "detector": "gliner"}],
        "u3": [{"label": "QUASI_IDENTIFIER.UNIQUE_ACHIEVEMENT", "value": "Lantern Award",
                "start": 7, "end": 20, "confidence": 0.8, "detector": "gliner"}],
    }
    risks = engine.assess(entities_by_turn)
    assert any(r["code"] == "COMBINATION_OF_CLUES" for r in risks), risks


def test_single_clue_is_not_overflagged():
    from coaching_privacy.context import RuleBasedContextRiskEngine

    engine = RuleBasedContextRiskEngine()
    entities_by_turn = {
        "u1": [{"label": "QUASI_IDENTIFIER.RARE_ROLE", "value": "accountant",
                "start": 4, "end": 14, "confidence": 0.6, "detector": "gliner"}],
    }
    risks = engine.assess(entities_by_turn)
    # A single common-role clue must not trigger COMBINATION_OF_CLUES
    assert not any(r["code"] == "COMBINATION_OF_CLUES" for r in risks), risks


def test_benign_transcript_has_no_context_risks():
    from coaching_privacy.context import RuleBasedContextRiskEngine

    engine = RuleBasedContextRiskEngine()
    entities_by_turn = {"u1": [], "u2": []}
    risks = engine.assess(entities_by_turn)
    assert risks == []


def test_unknown_language_fails_closed():
    """GLiNER runs on en only; unsupported language must route to review, not run."""
    from coaching_privacy.context import assert_supported_language

    try:
        assert_supported_language("fr")
    except ValueError as exc:
        assert "language" in str(exc).lower()
    else:
        raise AssertionError("unsupported language accepted")
    assert_supported_language("en")  # must not raise
