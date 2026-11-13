"""I19-S2 RED: ASR uncertainty never reaches the gate (issue #19 slice 2).

Requires: transcript_from_asr helper; engine reads metadata.asr.uncertain for
synthetic_audio and passes asr_uncertain to SafetyGate (fail closed on
missing/non-boolean); e2e degraded-vs-clean differential.
"""
from __future__ import annotations

import json
import pathlib

import pytest

pytestmark = pytest.mark.slow

REPO = pathlib.Path(__file__).resolve().parents[2]


def _asr_result(uncertain: bool | None) -> dict:
    base = {
        "text": "I want to lead better meetings.",
        "model": "tiny.en",
        "engine": "faster-whisper",
        "language": "en",
        "runtime_s": 1.2,
        "avg_logprob": -0.2,
        "speaker_attribution": "manual",
        "signals": {
            "min_avg_logprob": -0.2,
            "max_no_speech_prob": 0.05,
            "max_compression_ratio": 1.3,
            "language_probability": 0.99,
        },
    }
    if uncertain is not None:
        base["uncertain"] = uncertain
    return base


def _transcript_from_asr(asr: dict, purpose: str = "internal_coaching_analysis"):
    from coaching_privacy.asr_transcript import transcript_from_asr

    return transcript_from_asr(
        asr, session_id="s-i19", purpose=purpose,
        speakers=[{"id": "S1", "role": "COACH"}, {"id": "S2", "role": "CLIENT"}],
    )


def _process(transcript_dict):
    from coaching_privacy.contracts import Transcript
    from coaching_privacy.engine import process_transcript
    from coaching_privacy.policy import PolicyStore

    policy = PolicyStore(
        REPO / "policies" / "sample_policy.yaml"
    ).get(transcript_dict["purpose"])
    return process_transcript(Transcript.parse(transcript_dict), policy)


def test_transcript_from_asr_builds_canonical_transcript():
    t = _transcript_from_asr(_asr_result(uncertain=False))
    d = t if isinstance(t, dict) else t
    md = d["metadata"]
    assert d["source_type"] == "synthetic_audio"
    assert md["asr"]["uncertain"] is False
    assert md["asr"]["model"] == "tiny.en"
    assert md["asr"]["speaker_attribution"] == "manual"
    assert "signals" in md["asr"]
    assert d["utterances"][0]["text"].strip()


def _hand_transcript(uncertain: bool | None) -> dict:
    asr_md = {"model": "tiny.en", "engine": "faster-whisper",
              "speaker_attribution": "manual",
              "signals": {"min_avg_logprob": -0.2, "max_no_speech_prob": 0.05,
                          "max_compression_ratio": 1.3, "language_probability": 0.99}}
    if uncertain is not None:
        asr_md["uncertain"] = uncertain
    return {
        "schema_version": "1.0",
        "session_id": "s-i19",
        "source_type": "synthetic_audio",
        "purpose": "internal_coaching_analysis",
        "language": "en",
        "speakers": [{"id": "S1", "role": "COACH"}, {"id": "S2", "role": "CLIENT"}],
        "utterances": [{"id": "u1", "speaker_id": "S2", "start_ms": 0,
                        "end_ms": 3000, "text": "I want to lead better meetings."}],
        "metadata": {"synthetic": True, "audio_file": "clip.wav", "asr": asr_md},
    }


def test_uncertain_audio_routes_to_review():
    result = _process(_hand_transcript(uncertain=True))
    assert result.decision["decision"] == "REVIEW_REQUIRED", result.decision
    assert "asr_uncertainty_requires_review" in result.decision["review_reasons"]


def test_certain_audio_baseline_release():
    """Differential baseline: the SAME transcript without uncertainty must
    reach RELEASE_CANDIDATE — proving the ASR path is the cause."""
    result = _process(_hand_transcript(uncertain=False))
    assert result.decision["decision"] == "RELEASE_CANDIDATE", result.decision


def test_missing_uncertain_flag_fail_closed():
    """synthetic_audio transcript without metadata.asr.uncertain must never
    be RELEASE_CANDIDATE (fail closed: treated as uncertain)."""
    result = _process(_hand_transcript(uncertain=None))
    assert result.decision["decision"] != "RELEASE_CANDIDATE", result.decision
    assert "asr_uncertainty_requires_review" in result.decision["review_reasons"]


def test_report_records_asr_provenance():
    result = _process(_hand_transcript(uncertain=True))
    asr = result.report.get("asr") or {}
    assert asr.get("model") == "tiny.en"
    assert asr.get("uncertain") is True
    assert "signals" in asr
