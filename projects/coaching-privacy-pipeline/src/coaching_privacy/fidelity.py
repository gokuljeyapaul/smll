"""Deterministic semantic-fidelity checker (S2, scoped rubric).

Non-generative: keyword-overlap + polarity rules only. A transform that
changes client sentiment (concern -> satisfaction) or drops a required fact
must force REVIEW_REQUIRED/BLOCKED, never a silent pass (A16-scoped).
"""
from __future__ import annotations

import re

OK = "OK"
MUTANT_FLAGGED = "MUTANT_FLAGGED"
REQUIRED_FACT_MISSING = "REQUIRED_FACT_MISSING"

STOPWORDS = {
    "a", "an", "the", "is", "are", "was", "were", "be", "been", "by", "with",
    "of", "to", "in", "on", "at", "and", "or", "but", "his", "her", "their",
    "my", "our", "your", "it", "its", "as", "that", "this", "for", "from",
    "about", "into", "over", "under", "we", "they", "he", "she", "i", "you",
    "feels", "feel", "felt", "keeps", "keep", "kept", "also", "all", "has",
    "have", "had", "not", "no", "so", "very", "just", "been", "being",
}
# Deterministic lexicons (small, auditable; not a generative model)
CONCERN_MARKERS = {
    "frustrated", "pressure", "rescheduled", "stuck", "hard", "concern",
    "concerns", "worried", "anxious", "overwhelmed", "burnout", "conflict",
    "difficult", "struggling", "criticized",
}
CHANGE_SEEKING = {"want", "clearer", "improve", "change", "need", "set"}
SATISFACTION_MARKERS = {
    "happy", "satisfied", "loves", "fine", "great", "no", "none",
    "current", "perfect", "excellent", "wonderful", "pleased",
}


def _tokens(text: str) -> set[str]:
    raw = re.findall(r"[a-z']+", text.lower())
    out = set()
    for tok in raw:
        if tok in STOPWORDS or len(tok) <= 1:
            continue
        if tok.endswith("s") and len(tok) > 3:
            out.add(tok[:-1])
        out.add(tok)
    return out


class SemanticFidelityChecker:
    """Deterministic rubric: fact overlap + sentiment-inversion detection."""

    def check(self, required_facts: list[str], sanitized_text: str) -> dict:
        sanitized_tokens = _tokens(sanitized_text)
        has_satisfaction = bool(sanitized_tokens & SATISFACTION_MARKERS)
        statuses = []
        for fact in required_facts or []:
            fact_tokens = _tokens(fact)
            overlap = fact_tokens & sanitized_tokens
            ratio = (len(overlap) / len(fact_tokens)) if fact_tokens else 1.0
            has_concern = bool(fact_tokens & CONCERN_MARKERS)
            has_change_seek = bool(fact_tokens & CHANGE_SEEKING)
            topic_overlap = bool(overlap - {"client", "the", "customer"})
            if has_satisfaction and (has_concern or has_change_seek) and topic_overlap:
                # Sentiment inverted on the same topic: meaning was changed.
                statuses.append(MUTANT_FLAGGED)
            elif ratio >= 0.5:
                statuses.append(OK)
            elif has_satisfaction and (has_concern or has_change_seek):
                statuses.append(MUTANT_FLAGGED)
            else:
                statuses.append(REQUIRED_FACT_MISSING)

        if MUTANT_FLAGGED in statuses:
            return {
                "status": MUTANT_FLAGGED,
                "decision_impact": "REVIEW_REQUIRED",
                "per_fact": statuses,
            }
        if REQUIRED_FACT_MISSING in statuses:
            return {
                "status": REQUIRED_FACT_MISSING,
                "decision_impact": "REVIEW_REQUIRED",
                "per_fact": statuses,
            }
        return {"status": OK, "decision_impact": None, "per_fact": statuses}
