"""Cross-session linkage and combined release gate (S4).

Deterministic, closed-world: aggregation of quasi-identifier clue sets across
sessions belonging to the same persona path. Two individually low-risk
sessions that combine into an identifying profile must force review/block
(A11). A failed session in a group can never be promoted (fail-closed).
"""
from __future__ import annotations

from typing import Any

LINK_LABELS = {
    "QUASI_IDENTIFIER.RARE_ROLE",
    "QUASI_IDENTIFIER.PRECISE_LOCATION",
    "QUASI_IDENTIFIER.EXACT_EMPLOYER",
    "QUASI_IDENTIFIER.SMALL_TEAM",
    "QUASI_IDENTIFIER.UNIQUE_ACHIEVEMENT",
    "QUASI_IDENTIFIER.EXACT_EVENT_DATE",
}
# >=2 distinct quasi categories across >=2 distinct sessions
LINK_SESSION_THRESHOLD = 2
LINK_CATEGORY_THRESHOLD = 2

# Deterministic specificity filter: only multi-word values (or explicitly rare
# single tokens) count as linkable clues. A lone common word ("accountant",
# "teacher", a generic place name) is not identity-linking by itself.
RARE_SINGLE_TOKENS = {
    "auricwood labs": False,  # placeholder; multi-word anyway
}

def _is_specific(value: str) -> bool:
    v = value.strip().lower()
    if not v:
        return False
    if len(v.split()) >= 2:
        return True
    return v in {t for t in RARE_SINGLE_TOKENS if RARE_SINGLE_TOKENS[t]}



class CrossSessionLinker:
    def assess_sessions(
        self, session_entities: dict[str, list[dict[str, Any]]]
    ) -> list[dict[str, Any]]:
        per_session_categories: dict[str, set[str]] = {}
        for session_id, spans in session_entities.items():
            cats = set()
            for span in spans:
                label = span.get("label", "")
                if label in LINK_LABELS and _is_specific(span.get("value", "")):
                    cats.add(label)
            if cats:
                per_session_categories[session_id] = cats

        risks: list[dict[str, Any]] = []
        if len(per_session_categories) >= LINK_SESSION_THRESHOLD:
            union = set().union(*per_session_categories.values())
            if len(union) >= LINK_CATEGORY_THRESHOLD:
                risks.append(
                    {
                        "code": "MULTI_SESSION_LINK",
                        "sessions": sorted(per_session_categories),
                        "labels": sorted(union),
                        "rule": (f">= {LINK_SESSION_THRESHOLD} sessions with "
                                 f">= {LINK_CATEGORY_THRESHOLD} distinct quasi-identifier categories combined"),
                    }
                )
        return risks


class ReleaseGate:
    """Group-level release decision; never upgrades a member's decision."""

    def gate(
        self,
        per_session_decisions: dict[str, str],
        linkage_risks: list[dict[str, Any]],
    ) -> str:
        # Any failed/blocked member blocks the group release.
        if any(d in {"FAILED", "BLOCKED"} for d in per_session_decisions.values()):
            return "REVIEW_REQUIRED"
        if linkage_risks:
            return "REVIEW_REQUIRED"
        if all(d == "RELEASE_CANDIDATE" for d in per_session_decisions.values()):
            return "RELEASE_CANDIDATE"
        return "REVIEW_REQUIRED"
