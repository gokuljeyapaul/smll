"""Build a canonical Transcript from an ASR adapter result (I19-S2).

The helper keeps ASR provenance in metadata (model, engine,
speaker_attribution, uncertain, signals, language, language_probability) so
the engine gate can consume uncertainty and reports stay auditable. Raw
audio/PII never enters the transcript beyond the ASR text itself.
"""
from __future__ import annotations

from typing import Any


def transcript_from_asr(
    asr: dict[str, Any],
    session_id: str,
    purpose: str,
    speakers: list[dict[str, Any]],
    language: str = "en",
) -> dict[str, Any]:
    """Return a canonical transcript dict (contracts.Transcript-parseable)."""
    if not isinstance(asr, dict) or not asr.get("text"):
        raise ValueError("asr result must be a dict with non-empty text")
    asr_md = {
        "model": asr.get("model", "tiny.en"),
        "engine": asr.get("engine", "faster-whisper"),
        "speaker_attribution": asr.get("speaker_attribution", "manual"),
        "signals": asr.get("signals", {}),
    }
    if "language" in asr:
        asr_md["language"] = asr["language"]
    sig = asr.get("signals") or {}
    if "language_probability" in sig:
        asr_md["language_probability"] = sig["language_probability"]
    if "uncertain" in asr:
        asr_md["uncertain"] = asr["uncertain"]
    return {
        "schema_version": "1.0",
        "session_id": session_id,
        "source_type": "synthetic_audio",
        "purpose": purpose,
        "language": language,
        "speakers": speakers,
        "utterances": [
            {
                "id": "u1",
                "speaker_id": speakers[-1]["id"] if speakers else "S1",
                "start_ms": 0,
                "end_ms": int(asr.get("runtime_s", 0) * 1000),
                "text": asr["text"].strip(),
            }
        ],
        "metadata": {"synthetic": True, "asr": asr_md},
    }
