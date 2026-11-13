"""Purpose-aware transformation (S2).

Applies the loaded purpose policy to a transcript: real Presidio detection,
deterministic per-session replacements (same value+label -> same token, so a
third party mentioned in several turns is masked consistently), PRESERVE
semantics for relevant sensitive lived experience (no blanket erasure), and
the fail-closed decision. External sharing never auto-releases (A17).
"""
from __future__ import annotations

from dataclasses import dataclass
from types import SimpleNamespace
from typing import Any

from .contracts import Transcript


@dataclass
class TransformResult:
    sanitized_utterances: list[dict[str, Any]]
    sanitized: dict[str, Any]
    decision: dict[str, Any]
    report: dict[str, Any]


def transform_transcript(
    transcript: Transcript,
    policy: dict[str, Any],
    context_extractor: Any = None,
) -> TransformResult:
    from .engine import process_transcript

    result = process_transcript(
        transcript, policy, context_extractor=context_extractor
    )
    return TransformResult(
        sanitized_utterances=result.sanitized.get("utterances", []),
        sanitized=result.sanitized,
        decision=result.decision,
        report=result.report,
    )


def as_namespace(result: TransformResult) -> SimpleNamespace:
    return SimpleNamespace(
        sanitized_utterances=result.sanitized_utterances,
        sanitized=result.sanitized,
        decision=result.decision,
    )
