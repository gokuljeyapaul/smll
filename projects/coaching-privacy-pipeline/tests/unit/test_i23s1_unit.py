"""I23-S1 RED: reports claim unexecuted checks passed (issue #23 slice 1).

A report must not assert a pass for a stage that did not run:
- `cross_session_risks` must not be an empty "clean" list unless the linkage
  check actually ran.
- `semantic_fidelity` must not assert `turn_count_preserved: True` for a
  check that never executed (no reference facts at pipeline runtime).
"""
from __future__ import annotations

import pathlib

import pytest

pytestmark = pytest.mark.slow

REPO = pathlib.Path(__file__).resolve().parents[2]

TRANSCRIPT = {
    "schema_version": "1.0", "session_id": "i23-a", "source_type": "synthetic_text",
    "purpose": "internal_coaching_analysis", "language": "en",
    "speakers": [{"id": "S1", "role": "COACH"}, {"id": "S2", "role": "CLIENT"}],
    "utterances": [
        {"id": "u1", "speaker_id": "S2", "start_ms": None, "end_ms": None,
         "text": "I want to lead my team better."},
    ],
    "metadata": {"synthetic": True},
}


def _process():
    from coaching_privacy.contracts import Transcript
    from coaching_privacy.engine import process_transcript
    from coaching_privacy.policy import PolicyStore

    policy = PolicyStore(
        REPO / "policies" / "sample_policy.yaml"
    ).get(TRANSCRIPT["purpose"])
    return process_transcript(Transcript.parse(TRANSCRIPT), policy)


def test_cross_session_risks_not_claimed_clean_without_assessment():
    result = _process()
    csr = result.report.get("cross_session_risks")
    assert not isinstance(csr, list) or csr, (
        "cross_session_risks must not be an empty 'clean' list unless the "
        "linkage check ran; expected a NOT_ASSESSED marker"
    )
    if isinstance(csr, dict):
        assert csr.get("status") == "NOT_ASSESSED", csr


def test_semantic_fidelity_not_claimed_preserved_without_reference():
    result = _process()
    sf = result.report.get("semantic_fidelity")
    assert isinstance(sf, dict) and sf.get("status") == "NOT_ASSESSED", (
        f"semantic_fidelity must be NOT_ASSESSED (no reference facts at "
        f"pipeline runtime), got: {sf}"
    )
    assert "turn_count_preserved" not in sf or sf.get("turn_count_preserved") is not True
