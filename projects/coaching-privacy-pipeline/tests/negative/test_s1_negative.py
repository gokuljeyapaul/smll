"""S1 negative tests: malformed annotations, persona overlap fail closed."""
import json
import pytest
import pathlib
import sys

pytestmark = pytest.mark.fast

PROJECT = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(PROJECT / "src"))


def test_malformed_gold_span_rejected():
    from coaching_privacy.generator import validate_fixture_record

    record = {
        "fixture_id": "x",
        "subject_id": "P-001",
        "scenario_family": "direct_identity",
        "gold_spans": [
            {"utterance_id": "u1", "start": 5, "end": 2, "label": "DIRECT_PII.PERSON",
             "gold_value": "abc"}  # end < start: malformed
        ],
        "prohibited_leaks": [],
        "transcript": {
            "schema_version": "1.0", "session_id": "x", "source_type": "synthetic_text",
            "purpose": "internal_coaching_analysis", "language": "en",
            "speakers": [{"id": "S1", "role": "COACH"}, {"id": "S2", "role": "CLIENT"}],
            "utterances": [{"id": "u1", "speaker_id": "S1", "start_ms": None,
                            "end_ms": None, "text": "Hello world"}],
            "metadata": {"synthetic": True, "dataset_seed": 1},
        },
    }
    try:
        validate_fixture_record(record)
    except ValueError as exc:
        assert "gold" in str(exc).lower() or "span" in str(exc).lower()
    else:
        raise AssertionError("malformed gold span was accepted")


def test_persona_overlap_rejected():
    from coaching_privacy.generator import assert_disjoint_personas

    a = [{"subject_id": "P-1"}, {"subject_id": "P-2"}]
    b = [{"subject_id": "P-3"}, {"subject_id": "P-1"}]  # overlap!
    try:
        assert_disjoint_personas(a, b)
    except ValueError as exc:
        assert "overlap" in str(exc).lower() or "persona" in str(exc).lower()
    else:
        raise AssertionError("persona overlap was accepted")
