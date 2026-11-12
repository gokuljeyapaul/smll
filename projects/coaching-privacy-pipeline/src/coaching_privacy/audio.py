"""Audio-derived canonical transcript input (S5).

Same canonical schema as text transcripts, plus mandatory ASR provenance:
speaker attribution is never claimed to be automatic (ASR does not
diarize), and the source audio file is recorded for audit only.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from .contracts import ContractError, Speaker, Utterance, ALLOWED_SOURCE_TYPES

AUDIO_SOURCE_TYPES = {"synthetic_audio"}


@dataclass(frozen=True)
class AudioTranscriptInput:
    session_id: str
    speakers: tuple[Speaker, ...]
    utterances: tuple[Utterance, ...]
    metadata: dict[str, Any]

    @classmethod
    def parse(cls, data: dict[str, Any]) -> "AudioTranscriptInput":
        if not isinstance(data, dict):
            raise ContractError("audio transcript must be a JSON object")
        if data.get("source_type") not in AUDIO_SOURCE_TYPES:
            raise ContractError(
                f"audio transcript requires source_type synthetic_audio, "
                f"got {data.get('source_type')!r}"
            )
        metadata = data.get("metadata") or {}
        if not metadata.get("synthetic", False):
            raise ContractError("PoC accepts synthetic transcripts only")
        asr = metadata.get("asr")
        if not isinstance(asr, dict):
            raise ContractError(
                "audio transcripts require asr provenance metadata "
                "(model, engine, speaker_attribution)"
            )
        for key in ("model", "engine", "speaker_attribution"):
            if not asr.get(key):
                raise ContractError(
                    f"asr metadata missing {key!r}; speaker attribution must be explicit (ASR does not diarize)"
                )
        if asr.get("speaker_attribution") == "automatic":
            raise ContractError(
                "automatic speaker attribution is not supported by ASR; "
                "use manual or simulated attribution"
            )
        speakers = tuple(Speaker(s["id"], s["role"]) for s in data.get("speakers", []))
        utterances = tuple(
            Utterance(
                id=u["id"], speaker_id=u["speaker_id"],
                start_ms=u.get("start_ms"), end_ms=u.get("end_ms"),
                text=u["text"],
            )
            for u in data.get("utterances", [])
        )
        if not utterances:
            raise ContractError("audio transcript has no utterances")
        return cls(
            session_id=data["session_id"],
            speakers=speakers,
            utterances=utterances,
            metadata=dict(metadata),
        )
