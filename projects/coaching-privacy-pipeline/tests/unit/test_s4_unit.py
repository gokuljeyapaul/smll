"""S4 unit tests: cross-session aggregation + linkage rules (A11, A18)."""
import sys
import pytest
import pathlib

pytestmark = pytest.mark.fast

PROJECT = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(PROJECT / "src"))


def test_linked_sessions_combination_is_flagged():
    from coaching_privacy.linkage import CrossSessionLinker

    linker = CrossSessionLinker()
    # Two individually low-risk sessions, same persona clues
    session_entities = {
        "s1": [{"label": "QUASI_IDENTIFIER.RARE_ROLE", "value": "Director of Lunar Logistics"},
               {"label": "QUASI_IDENTIFIER.EXACT_EMPLOYER", "value": "Auricwood Labs"}],
        "s2": [{"label": "QUASI_IDENTIFIER.PRECISE_LOCATION", "value": "Sylvar City"},
               {"label": "QUASI_IDENTIFIER.UNIQUE_ACHIEVEMENT", "value": "Lantern Award"}],
    }
    risks = linker.assess_sessions(session_entities)
    assert any(r["code"] == "MULTI_SESSION_LINK" for r in risks), risks


def test_unrelated_sessions_not_linked():
    from coaching_privacy.linkage import CrossSessionLinker

    linker = CrossSessionLinker()
    session_entities = {
        "s1": [{"label": "QUASI_IDENTIFIER.RARE_ROLE", "value": "accountant"}],
        "s2": [{"label": "QUASI_IDENTIFIER.PRECISE_LOCATION", "value": "Northgate"}],
    }
    risks = linker.assess_sessions(session_entities)
    assert not any(r["code"] == "MULTI_SESSION_LINK" for r in risks), risks


def test_release_gate_blocks_linked_combination():
    from coaching_privacy.linkage import ReleaseGate

    gate = ReleaseGate()
    decision = gate.gate(
        per_session_decisions={"s1": "RELEASE_CANDIDATE", "s2": "RELEASE_CANDIDATE"},
        linkage_risks=[{"code": "MULTI_SESSION_LINK", "sessions": ["s1", "s2"]}],
    )
    assert decision in {"REVIEW_REQUIRED", "BLOCKED"}


def test_release_gate_passes_unlinked_benign():
    from coaching_privacy.linkage import ReleaseGate

    gate = ReleaseGate()
    decision = gate.gate(
        per_session_decisions={"s1": "RELEASE_CANDIDATE", "s2": "RELEASE_CANDIDATE"},
        linkage_risks=[],
    )
    assert decision == "RELEASE_CANDIDATE"


def test_failed_session_never_promoted_by_group():
    from coaching_privacy.linkage import ReleaseGate

    gate = ReleaseGate()
    decision = gate.gate(
        per_session_decisions={"s1": "FAILED", "s2": "RELEASE_CANDIDATE"},
        linkage_risks=[],
    )
    # a failed session in the group must not silently become releasable
    assert decision != "RELEASE_CANDIDATE"
