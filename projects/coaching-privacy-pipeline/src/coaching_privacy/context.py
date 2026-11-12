"""Deterministic cross-turn context risk rules (S3).

Non-generative: fixed combination rules over detected entity spans. A rare
role + precise location + unique achievement across turns is a
COMBINATION_OF_CLUES even when no single PII entity appears (A10).
"""
from __future__ import annotations

from typing import Any

SUPPORTED_LANGUAGES = {"en"}

# Labels that participate in combination risk
COMBINATION_LABELS = {
    "QUASI_IDENTIFIER.RARE_ROLE",
    "QUASI_IDENTIFIER.PRECISE_LOCATION",
    "QUASI_IDENTIFIER.EXACT_EMPLOYER",
    "QUASI_IDENTIFIER.SMALL_TEAM",
    "QUASI_IDENTIFIER.UNIQUE_ACHIEVEMENT",
    "QUASI_IDENTIFIER.EXACT_EVENT_DATE",
}
COMBINATION_THRESHOLD = 2  # >=2 distinct quasi categories across turns


def assert_supported_language(language: str) -> None:
    if language not in SUPPORTED_LANGUAGES:
        raise ValueError(f"unsupported language for contextual detection: {language!r}")


class RuleBasedContextRiskEngine:
    """Deterministic aggregation of quasi-identifier clues across turns."""

    def assess(self, entities_by_turn: dict[str, list[dict[str, Any]]]) -> list[dict[str, Any]]:
        found: dict[str, list[str]] = {}
        for turn_id, spans in entities_by_turn.items():
            for span in spans:
                label = span.get("label", "")
                if label in COMBINATION_LABELS:
                    found.setdefault(label, []).append(turn_id)

        risks: list[dict[str, Any]] = []
        if len(found) >= COMBINATION_THRESHOLD:
            risks.append(
                {
                    "code": "COMBINATION_OF_CLUES",
                    "labels": sorted(found),
                    "turn_ids": sorted({t for ts in found.values() for t in ts}),
                    "rule": f">= {COMBINATION_THRESHOLD} distinct quasi-identifier categories across turns",
                }
            )
        return risks
