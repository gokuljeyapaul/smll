"""The BM25 top-passage extract baseline — the boring default every SLM must beat:
keyword search + show the best passages. Also the app's 'find passages' mode."""
from __future__ import annotations

import re
from typing import Any

_STOP = set(
    "the a an of to in on for and or is are was were what which who how when where "
    "does do did with by at from this that it its as be been"
    .split())
_WORD = re.compile(r"[a-z0-9$%]+")


def _terms(text: str) -> list[str]:
    return [w for w in _WORD.findall(text.lower()) if w not in _STOP]


def extract_key_sentences(question: str, passages: list[str], max_sentences: int = 3) -> list[str]:
    """The extractive baseline answer: the sentences in the top passages with the highest
    term overlap with the question (BM25-style, no model)."""
    q = set(_terms(question))
    scored: list[tuple[float, str]] = []
    for p in passages:
        for sent in re.split(r"(?<=[.!?])\s+", p):
            s = _terms(sent)
            if not s:
                continue
            overlap = len(q & set(s))
            if overlap == 0:
                continue
            scored.append((overlap / (len(s) ** 0.5), sent.strip()))
    scored.sort(key=lambda t: -t[0])
    return [s for _, s in scored[:max_sentences]]


def passages_answer(question: str, hits: list[dict[str, Any]], max_sentences: int = 3) -> dict[str, Any]:
    """'Find passages' mode (the shipped default when the SLM does not beat this baseline,
    and the fallback when an SLM answer times out): never invents — shows passages."""
    sentences = extract_key_sentences(question, [h["text"] for h in hits], max_sentences)
    top = hits[:3]
    return {
        "mode": "passages",
        "not_found": len(top) == 0,
        "key_sentences": sentences,
        "passages": [
            {"file": h["file"], "page": h.get("page"), "heading": h.get("heading"), "text": h["text"]}
            for h in top
        ],
    }
