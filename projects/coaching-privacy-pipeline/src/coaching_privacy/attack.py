"""Fictional closed-world attack simulation (S4, A18).

Deterministic scoring of sanitized-output clues against an evaluator-only
fictional directory. Reports top-1 match, true rank, abstention, chance
baseline and assumptions — with denominators. Never queries real people or
external services; gold labels are rejected as input.
"""
from __future__ import annotations

from typing import Any

FORBIDDEN_GOLD_KEYS = {"gold_spans", "gold_value", "subject_id_gold", "gold_labels"}


class AttackSimulator:
    closed_world = True

    def run(
        self,
        directory: list[dict[str, Any]],
        sanitized_clues: dict[str, Any],
        true_subject_id: str,
    ) -> dict[str, Any]:
        # Gold-bearing input is rejected: the attacker sees only sanitized output.
        for key in sanitized_clues:
            if key in FORBIDDEN_GOLD_KEYS:
                raise ValueError(f"gold-bearing input rejected: {key!r}")
        if not isinstance(directory, list) or not directory:
            raise ValueError("closed-world directory required")

        # Score each candidate by clue overlap.
        clues = {k: v for k, v in sanitized_clues.items() if v}
        if not clues:
            return {
                "abstained": True,
                "top1_match": False,
                "true_rank": None,
                "directory_size": len(directory),
                "chance_baseline": round(1.0 / len(directory), 4),
                "assumptions": [
                    "attacker has no usable clues; abstention is honest",
                    "closed fictional directory only; no real-person lookup",
                ],
            }

        scored: list[tuple[float, str]] = []
        for entry in directory:
            score = 0.0
            for clue_key, clue_value in clues.items():
                candidate_values = " ".join(
                    str(v) for v in entry.values() if isinstance(v, str)
                ).lower()
                if str(clue_value).lower() in candidate_values:
                    score += 1.0
            scored.append((score, str(entry.get("subject_id"))))

        ranked = sorted(scored, key=lambda t: (-t[0], t[1]))
        true_rank = next(
            (i + 1 for i, (_, sid) in enumerate(ranked) if sid == true_subject_id),
            None,
        )
        top1_match = ranked[0][1] == true_subject_id and ranked[0][0] > 0

        return {
            "abstained": False,
            "top1_match": top1_match,
            "true_rank": true_rank,
            "directory_size": len(directory),
            "chance_baseline": round(1.0 / len(directory), 4),
            "top_score": ranked[0][0],
            "assumptions": [
                "attacker matches sanitized quasi-identifier strings exactly (upper bound on naive attacker)",
                "closed fictional directory only; no real-person lookup or web search",
                "chance baseline = 1/directory_size for a random guess",
            ],
        }
