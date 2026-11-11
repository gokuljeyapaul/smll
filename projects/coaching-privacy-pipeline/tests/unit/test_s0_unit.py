"""S0 unit tests: transcript loading, contracts, deterministic redaction helpers.

RED-phase: these tests describe the S0 target behavior and are expected to
fail on the not-yet-implemented modules.
"""
import json
import pathlib

import pytest

PROJECT = pathlib.Path(__file__).resolve().parents[2]
FIXTURES = PROJECT / "fixtures"


# --- transcript parsing / validation (A02) ---

def test_load_valid_seed_fixture_transcript():
    from coaching_privacy.contracts import Transcript
    line = (FIXTURES / "seed_fixtures.jsonl").read_text().splitlines()[0]
    record = json.loads(line)
    transcript = Transcript.parse(record["transcript"])
    assert transcript.session_id == "fictional-S01"
    assert transcript.purpose == "internal_coaching_analysis"
    assert [u.id for u in transcript.utterances] == ["u1", "u2"]
    assert transcript.utterances[1].speaker_id == "S2"


def test_unknown_purpose_rejected_fail_closed():
    from coaching_privacy.contracts import PolicyError, Transcript
    with pytest.raises(PolicyError):
        Transcript.parse({
            "schema_version": "1.0",
            "session_id": "x",
            "source_type": "synthetic_text",
            "purpose": "totally_unknown_purpose",
            "language": "en",
            "speakers": [{"id": "S1", "role": "COACH"}, {"id": "S2", "role": "CLIENT"}],
            "utterances": [{"id": "u1", "speaker_id": "S1", "start_ms": None, "end_ms": None,
                            "text": "Hello."}],
            "metadata": {"synthetic": True},
        })


def test_malformed_json_and_disallowed_source_fail_closed():
    from coaching_privacy.contracts import ContractError, Transcript
    base = {
        "schema_version": "1.0",
        "session_id": "x",
        "source_type": "synthetic_text",
        "purpose": "internal_coaching_analysis",
        "language": "en",
        "speakers": [{"id": "S1", "role": "COACH"}, {"id": "S2", "role": "CLIENT"}],
        "utterances": [{"id": "u1", "speaker_id": "S1", "start_ms": None, "end_ms": None,
                        "text": "Hello."}],
        "metadata": {"synthetic": True},
    }
    bad_version = dict(base, schema_version="999.0")
    with pytest.raises(ContractError):
        Transcript.parse(bad_version)
    real_source = dict(base, source_type="real_recording_upload")
    with pytest.raises(ContractError):
        Transcript.parse(real_source)


def test_policy_file_load_and_unknown_policy_rejected():
    from coaching_privacy.policy import PolicyStore
    store = PolicyStore(FIXTURES.parent / "policies" / "sample_policy.yaml")
    pol = store.get("internal_coaching_analysis")
    assert pol["direct_pii"][0] in ("REPLACE", "SUPPRESS")
    with pytest.raises(KeyError):
        store.get("no_such_policy")


# --- deterministic replacement (A08) ---

def test_deterministic_replacement_same_value_same_token():
    from coaching_privacy.transform import StableReplacer
    replacer = StableReplacer()
    tok1 = replacer.replacement_for("PERSON", "Mira Solen")
    tok2 = replacer.replacement_for("PERSON", "Mira Solen")
    assert tok1 == tok2
    assert "Mira" not in tok1
    assert tok1.startswith("<") and tok1.endswith(">")


def test_redaction_preserves_turn_structure_and_offsets():
    from coaching_privacy.transform import redact_utterance
    text = "My name is Mira Solen, and my email is mira.solen@example.test."
    spans = [
        {"start": 11, "end": 21, "label": "DIRECT_PII.PERSON", "value": "Mira Solen"},
        {"start": 39, "end": 62, "label": "DIRECT_PII.EMAIL", "value": "mira.solen@example.test"},
    ]
    result = redact_utterance(text, spans)
    assert "Mira Solen" not in result["text"]
    assert "mira.solen@example.test" not in result["text"]
    assert result["text"].startswith("My name is ")
    # second sentence preserved
    assert result["text"].rstrip().endswith(".")
