"""I20-S1 RED/Step 0: GLiNER truncation on long sessions (issue #20 slice 1).

A seeded synthetic 48-turn session with a gold two-clue combination
(employer + precise location) placed ONLY in the final turns. If GLiNER
truncates input beyond its ~384-token window, the clues are never detected
and COMBINATION_OF_CLUES is not reported (fail-open hole).
"""
from __future__ import annotations

import json
import pathlib

import pytest

pytestmark = pytest.mark.slow

REPO = pathlib.Path(__file__).resolve().parents[2]


def _long_session_transcript() -> dict:
    turns = []
    # 44 benign filler turns, comfortably over the model's ~384-token window.
    for i in range(44):
        turns.append(
            {
                "id": f"u{i + 1}",
                "speaker_id": "S1" if i % 2 == 0 else "S2",
                "start_ms": None,
                "end_ms": None,
                "text": (
                    f"Let us keep exploring goal number {i + 1} and how the "
                    "coaching relationship supports your growth this quarter."
                ),
            }
        )
    # Gold clues in the FINAL turns only.
    turns.append({
        "id": "u45", "speaker_id": "S2", "start_ms": None, "end_ms": None,
        "text": "I work as the Head of Cartography at Marlowe Systems.",
    })
    turns.append({
        "id": "u46", "speaker_id": "S2", "start_ms": None, "end_ms": None,
        "text": "Our office is in the harbor district of Duncastle.",
    })
    return {
        "schema_version": "1.0",
        "session_id": "i20-long",
        "source_type": "synthetic_text",
        "purpose": "internal_coaching_analysis",
        "language": "en",
        "speakers": [{"id": "S1", "role": "COACH"}, {"id": "S2", "role": "CLIENT"}],
        "utterances": turns,
        "metadata": {"synthetic": True},
    }


def test_long_session_tail_clues_detected():
    result = _process(_long_session_transcript())
    codes = [r["code"] for r in result.report.get("context_risks", [])]
    assert "COMBINATION_OF_CLUES" in codes, (
        f"gold clues in the final turns were not detected (codes: {codes}); "
        "truncation or window drop suspected"
    )


def test_single_clue_in_last_turn_reported_when_isolated():
    """A single clue category alone does not raise COMBINATION (threshold 2)
    but must appear in context_spans if it survives the window."""
    t = _long_session_transcript()
    # remove the employer clue; keep the location clue
    t["utterances"] = t["utterances"][:-2] + [t["utterances"][-1]]
    result = _process(t)
    spans = result.report.get("context_spans", {})
    assert any(
        e.get("label") == "QUASI_IDENTIFIER.PRECISE_LOCATION"
        for entries in spans.values()
        for e in entries
    ), "location clue in the last turn was not detected"


def test_benign_long_session_not_overflagged():
    t = _long_session_transcript()
    t["utterances"] = t["utterances"][:-2]  # no clues at all
    result = _process(t)
    assert result.report.get("context_risks", []) == [], result.report["context_risks"]
    assert result.decision["decision"] in {"RELEASE_CANDIDATE", "REVIEW_REQUIRED"}


def _process(transcript_dict):
    from coaching_privacy.contracts import Transcript
    from coaching_privacy.engine import process_transcript
    from coaching_privacy.policy import PolicyStore

    policy = PolicyStore(
        REPO / "policies" / "sample_policy.yaml"
    ).get(transcript_dict["purpose"])
    return process_transcript(Transcript.parse(transcript_dict), policy)
