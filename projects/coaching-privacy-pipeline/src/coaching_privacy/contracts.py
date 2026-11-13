"""Typed data contracts for canonical transcripts and annotations.

Fail-closed parsing: unknown schema versions, disallowed source types and
unknown purposes are rejected with typed errors (A02).
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Optional

SUPPORTED_SCHEMA_VERSION = "1.0"
ALLOWED_SOURCE_TYPES = {"synthetic_text", "synthetic_audio"}
SUPPORTED_LANGUAGES = {"en"}
KNOWN_PURPOSES = {"internal_coaching_analysis", "external_sharing"}


class ContractError(ValueError):
    """Raised for malformed or unsupported transcript content."""


class PolicyError(ContractError):
    """Raised for unknown or disallowed processing purposes."""


@dataclass(frozen=True)
class Speaker:
    id: str
    role: str


@dataclass(frozen=True)
class Utterance:
    id: str
    speaker_id: str
    start_ms: Optional[int]
    end_ms: Optional[int]
    text: str


@dataclass(frozen=True)
class Transcript:
    schema_version: str
    session_id: str
    source_type: str
    purpose: str
    language: str
    speakers: tuple[Speaker, ...]
    utterances: tuple[Utterance, ...]
    metadata: dict[str, Any] = field(default_factory=dict)

    @classmethod
    def parse(cls, data: dict[str, Any]) -> "Transcript":
        if not isinstance(data, dict):
            raise ContractError("transcript must be a JSON object")
        if data.get("schema_version") != SUPPORTED_SCHEMA_VERSION:
            raise ContractError(
                f"unsupported schema_version: {data.get('schema_version')!r}"
            )
        source = data.get("source_type")
        if source not in ALLOWED_SOURCE_TYPES:
            raise ContractError(f"disallowed source_type: {source!r}")
        purpose = data.get("purpose")
        if not isinstance(purpose, str) or not purpose:
            raise PolicyError(f"missing or invalid purpose: {purpose!r}")
        if purpose not in KNOWN_PURPOSES:
            # Fail closed: unknown purpose can never be approved.
            raise PolicyError(f"unknown purpose: {purpose!r}")
        language = data.get("language")
        # I11-S1: well-formed 2-letter codes parse even if unsupported;
        # the engine's language gate handles them per-session. Malformed
        # values remain a contract error (fail closed).
        if not isinstance(language, str) or len(language) != 2 or not language.islower():
            raise ContractError(f"unsupported language: {language!r}")
        metadata = data.get("metadata") or {}
        if not metadata.get("synthetic", False):
            raise ContractError("PoC accepts synthetic transcripts only")
        speakers = tuple(
            Speaker(s["id"], s["role"]) for s in data.get("speakers", [])
        )
        utterances = tuple(
            Utterance(
                id=u["id"],
                speaker_id=u["speaker_id"],
                start_ms=u.get("start_ms"),
                end_ms=u.get("end_ms"),
                text=u["text"],
            )
            for u in data.get("utterances", [])
        )
        if not utterances:
            raise ContractError("transcript has no utterances")
        return cls(
            schema_version=data["schema_version"],
            session_id=data["session_id"],
            source_type=source,
            purpose=purpose,
            language=data["language"],
            speakers=speakers,
            utterances=utterances,
            metadata=dict(metadata),
        )

    def speaker_roles(self) -> dict[str, str]:
        return {s.id: s.role for s in self.speakers}
