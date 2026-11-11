"""Deterministic, non-generative transformations (A08).

Same value+label always maps to the same replacement within a session;
turn structure and text order are preserved.
"""
from __future__ import annotations

import hashlib
from typing import Any


class StableReplacer:
    """Deterministic token replacements: hash(value|label) -> <TYPE_XXXX>."""

    def __init__(self) -> None:
        self._cache: dict[tuple[str, str], str] = {}

    def replacement_for(self, label: str, value: str) -> str:
        key = (label, value)
        if key not in self._cache:
            digest = hashlib.sha256(f"{label}|{value}".encode()).hexdigest()[:8]
            short_label = label.split(".")[-1] if "." in label else label
            self._cache[key] = f"<{short_label}_{digest}>"
        return self._cache[key]


def redact_utterance(text: str, spans: list[dict[str, Any]]) -> dict[str, Any]:
    """Replace the given spans (start/end offsets on unmodified text).

    Overlapping spans are resolved by preferring the earliest, longest span.
    Returns {'text': redacted, 'applied': [ {start,end,label,replacement} ]}.
    """
    ordered = sorted(spans, key=lambda s: (s["start"], -(s["end"] - s["start"])))
    applied: list[dict[str, Any]] = []
    out: list[str] = []
    cursor = 0
    for span in ordered:
        start, end = span["start"], span["end"]
        if start < cursor:
            continue  # overlap: skip
        if start < 0 or end > len(text) or start >= end:
            continue  # invalid offset: skip, never corrupt output
        out.append(text[cursor:start])
        replacement = span.get("replacement") or f"<{span['label'].split('.')[-1]}>"
        out.append(replacement)
        applied.append(
            {
                "start": start,
                "end": end,
                "label": span["label"],
                "replacement": replacement,
            }
        )
        cursor = end
    out.append(text[cursor:])
    return {"text": "".join(out), "applied": applied}
