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

# I10-S2: specificity filter (mirrors linkage.py's rule). A span counts as a
# linkable clue only when it is genuinely identifying:
# - a bare calendar month ("May") is not an EXACT_EVENT_DATE (baseline
#   seed-S10 false-REVIEW; specific dates like "17 July 2025" still count);
# - a single-word generic role ("colleagues", "support") with confidence
#   below RARE_ROLE_SINGLE_WORD_MIN_CONFIDENCE is not a RARE_ROLE (baseline
#   seed-S02 false-REVIEW; "manager" at 0.75 and multi-word roles still count).
_MONTHS = {
    "january", "february", "march", "april", "may", "june", "july",
    "august", "september", "october", "november", "december",
}
RARE_ROLE_SINGLE_WORD_MIN_CONFIDENCE = 0.5


def _is_specific_combination_clue(label: str, value: str, confidence: Any) -> bool:
    v = value.strip().lower()
    if not v:
        return False
    if label == "QUASI_IDENTIFIER.EXACT_EVENT_DATE":
        if v in _MONTHS and len(v.split()) == 1:
            return False  # bare month, not an exact date
        return True
    if label == "QUASI_IDENTIFIER.RARE_ROLE":
        if len(v.split()) == 1:
            try:
                if float(confidence) < RARE_ROLE_SINGLE_WORD_MIN_CONFIDENCE:
                    return False
            except (TypeError, ValueError):
                return False
        return True
    return True


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
                if label in COMBINATION_LABELS and _is_specific_combination_clue(
                    label, span.get("value", ""), span.get("confidence")
                ):
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
