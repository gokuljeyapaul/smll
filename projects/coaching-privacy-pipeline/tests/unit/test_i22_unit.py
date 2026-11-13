"""I22-S1 RED: the independent validator only checks gold leak lists (issue #22).

With prohibited_leaks=[] (the realistic case for non-evaluation input), a
re-inserted structured identifier must still be caught -> BLOCKED. Today the
validator scans nothing, so the leak is released. Tests simulate a faulty
transform via a test seam (re-inserting an identifier into sanitized text).
"""
from __future__ import annotations

import json
import pathlib

import pytest

pytestmark = pytest.mark.slow

REPO = pathlib.Path(__file__).resolve().parents[2]


def _seed_fixture(idx: int = 0) -> dict:
    line = (REPO / "fixtures" / "seed_fixtures.jsonl").read_text().splitlines()[idx]
    return json.loads(line)


def _process(transcript_dict, prohibited_leaks=None, context_extractor=None):
    from coaching_privacy.contracts import Transcript
    from coaching_privacy.engine import process_transcript
    from coaching_privacy.policy import PolicyStore

    policy = PolicyStore(
        REPO / "policies" / "sample_policy.yaml"
    ).get(transcript_dict["purpose"])
    return process_transcript(
        Transcript.parse(transcript_dict), policy,
        prohibited_leaks=prohibited_leaks,
        context_extractor=context_extractor,
    )


def test_reinserted_email_blocked_without_gold_list():
    """Faulty-transform seam: an identifier is re-inserted into sanitized
    text; prohibited_leaks=[] (no gold). Decision must be BLOCKED."""
    fixture = _seed_fixture(0)  # S01: email/name transcript
    result = _process(fixture["transcript"], prohibited_leaks=[])
    # Simulate the faulty transform: re-insert the email into sanitized text
    result.sanitized["utterances"][1]["text"] = (
        "My name is Mira Solen, and my personal email is "
        "mira.solen@example.test. I want to change how I lead meetings."
    )
    from coaching_privacy.pipeline import SafetyGate
    from coaching_privacy.validator import IndependentLeakValidator

    validator = IndependentLeakValidator()
    report = validator.validate(
        prohibited_leaks=[],
        sanitized_utterances=result.sanitized["utterances"],
    )
    decision = SafetyGate().decide(
        {**report, "all_mandatory_stages_executed": True},
        purpose="internal_coaching_analysis",
    )
    assert decision["decision"] == "BLOCKED", decision
    assert "confirmed_residual_pii" in decision["review_reasons"]


def test_reinserted_phone_blocked_without_gold_list():
    fixture = _seed_fixture(1)  # S02: phone/address transcript
    result = _process(fixture["transcript"], prohibited_leaks=[])
    result.sanitized["utterances"][0]["text"] = (
        "Someone may call me on 202-555-0147 at 18 Maple Terrace, Suite 4. "
        "I want to set boundaries with colleagues."
    )
    from coaching_privacy.pipeline import SafetyGate
    from coaching_privacy.validator import IndependentLeakValidator

    report = validator_report(result.sanitized["utterances"])
    decision = SafetyGate().decide(
        {**report, "all_mandatory_stages_executed": True},
        purpose="internal_coaching_analysis",
    )
    assert decision["decision"] == "BLOCKED", decision


def validator_report(utterances):
    from coaching_privacy.validator import IndependentLeakValidator

    return IndependentLeakValidator().validate(
        prohibited_leaks=[], sanitized_utterances=utterances
    )


def test_clean_text_no_findings():
    """Clean sanitized text must produce no residual findings (no false
    positives on benign coaching talk)."""
    utterances = [
        {"id": "u1", "text": "What would you like to focus on today?"},
        {"id": "u2", "text": "I want to lead <PERSON> meetings better."},
    ]
    report = validator_report(utterances)
    assert report["residual_pii"] == [], report


def test_echo_check_catches_leaked_detected_value():
    """A raw value the detector replaced must not survive in sanitized text."""
    utterances = [
        {"id": "u1", "text": "Reach me at someone@example.org any time."},
    ]
    report = IndependentLeakValidator().validate(
        prohibited_leaks=[],
        sanitized_utterances=utterances,
        replaced_values=["someone@example.org"],
    )
    assert report["leak_count"] >= 1, report
    entries = json.dumps(report)
    assert "someone@example.org" not in entries  # never echo the raw value


def test_reported_findings_never_contain_raw_values():
    utterances = [
        {"id": "u2", "text": "My card is 4539 1488 0343 6467, please help."},
    ]
    report = IndependentLeakValidator().validate(
        prohibited_leaks=[], sanitized_utterances=utterances
    )
    assert report["leak_count"] >= 1, report
    dumped = json.dumps(report)
    assert "4539" not in dumped and "6467" not in dumped


from coaching_privacy.validator import IndependentLeakValidator  # noqa: E402
