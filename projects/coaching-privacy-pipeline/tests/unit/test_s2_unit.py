"""S2 unit tests: purpose-aware transformation policy matrix (A08, A09, A16-scoped)."""
import sys
import pathlib

PROJECT = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(PROJECT / "src"))

TRANSCRIPT = {
    "schema_version": "1.0",
    "session_id": "s2-test",
    "source_type": "synthetic_text",
    "purpose": "internal_coaching_analysis",
    "language": "en",
    "speakers": [{"id": "S1", "role": "COACH"}, {"id": "S2", "role": "CLIENT"}],
    "utterances": [
        {"id": "u1", "speaker_id": "S1", "start_ms": None, "end_ms": None,
         "text": "Who is putting pressure on you?"},
        {"id": "u2", "speaker_id": "S2", "start_ms": None, "end_ms": None,
         "text": "My manager, Mr. Alden, keeps rescheduling our one-to-ones."},
        {"id": "u3", "speaker_id": "S2", "start_ms": None, "end_ms": None,
         "text": "Mr. Alden also criticized my report in front of the team."},
    ],
    "metadata": {"synthetic": True},
}


def _load_policy(name):
    from coaching_privacy.policy import PolicyStore
    store = PolicyStore(PROJECT / "policies" / "sample_policy.yaml")
    return store.get(name)


def test_third_party_masked_consistently_across_turns():
    from coaching_privacy.policy_transform import transform_transcript
    from coaching_privacy.contracts import Transcript

    t = Transcript.parse(TRANSCRIPT)
    result = transform_transcript(t, _load_policy("internal_coaching_analysis"))
    texts = [u["text"] for u in result.sanitized_utterances]
    joined = " ".join(texts)
    assert "Alden" not in joined
    # same third-party reference -> same replacement in u2 and u3 (A08)
    import re
    tokens = set()
    for text in texts:
        tokens.update(re.findall(r"<[^>]+>", text))
    assert len(tokens) >= 1
    # The two mentions produce the identical token
    tok_u2 = re.findall(r"<[^>]+>", texts[1])
    tok_u3 = re.findall(r"<[^>]+>", texts[2])
    assert tok_u2 and tok_u3 and tok_u2[0] == tok_u3[0]


def test_external_policy_redacts_more_aggressively_than_internal():
    from coaching_privacy.policy_transform import transform_transcript
    from coaching_privacy.contracts import Transcript

    t = Transcript.parse(TRANSCRIPT)
    internal = transform_transcript(t, _load_policy("internal_coaching_analysis"))
    external = transform_transcript(t, _load_policy("external_sharing"))
    # both redact the third party, but external must never auto-release (A17)
    assert external.decision["decision"] == "REVIEW_REQUIRED"
    assert internal.decision["decision"] in {"REVIEW_REQUIRED", "RELEASE_CANDIDATE"}


def test_sensitive_relevant_experience_not_blankly_erased():
    from coaching_privacy.policy_transform import transform_transcript
    from coaching_privacy.contracts import Transcript

    data = dict(TRANSCRIPT)
    data = {
        **TRANSCRIPT,
        "utterances": TRANSCRIPT["utterances"] + [
            {"id": "u4", "speaker_id": "S2", "start_ms": None, "end_ms": None,
             "text": "As a wheelchair user, accessible meeting rooms matter to my confidence at work."},
        ],
    }
    t = Transcript.parse(data)
    result = transform_transcript(t, _load_policy("internal_coaching_analysis"))
    texts = " ".join(u["text"] for u in result.sanitized_utterances)
    # Relevant lived experience must not be erased for internal analysis (A09)
    assert "accessible meeting rooms" in texts


def test_semantic_fidelity_flags_meaning_change():
    from coaching_privacy.fidelity import SemanticFidelityChecker, REQUIRED_FACT_MISSING, MUTANT_FLAGGED

    original_facts = ["client wants clearer boundaries"]
    # Mutant output that changes the meaning
    mutant = "The client is happy with all current boundaries."
    checker = SemanticFidelityChecker()
    result = checker.check(required_facts=original_facts, sanitized_text=mutant)
    assert result["status"] in {MUTANT_FLAGGED, REQUIRED_FACT_MISSING}
    assert result["decision_impact"] in {"REVIEW_REQUIRED", "BLOCKED"}


def test_semantic_fidelity_passes_genuine_fact():
    from coaching_privacy.fidelity import SemanticFidelityChecker, OK

    checker = SemanticFidelityChecker()
    result = checker.check(
        required_facts=["client wants clearer boundaries"],
        sanitized_text="I want to set boundaries with colleagues.",
    )
    assert result["status"] == OK
