"""Chunker: blocks of anchored text -> size-capped chunks that keep their anchors and
never cut mid-word."""
from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any

_SENTENCE_END = re.compile(r"(?<=[.!?])\s")


@dataclass
class Chunk:
    text: str
    page: int | None
    heading: str | None
    file_id: int | None = None
    chunk_id: int | None = None


def chunk_blocks(blocks: list[dict[str, Any]], max_chars: int = 1200, overlap: int = 150) -> list[Chunk]:
    """Merge anchored blocks into chunks of at most max_chars characters.

    Chunks never cut mid-word: a cut lands on the last sentence boundary (or word
    boundary) that fits. Overlap carries a tail of the previous chunk into the next so
    facts that straddle a cut stay retrievable. The chunk inherits the anchor (page,
    heading) of the block it starts in."""
    chunks: list[Chunk] = []
    current = ""
    current_anchor: tuple[int | None, str | None] = (None, None)
    current_len = 0

    def flush() -> None:
        nonlocal current, current_len
        text = current.strip()
        if text:
            chunks.append(Chunk(text=text, page=current_anchor[0], heading=current_anchor[1]))
        current, current_len = "", 0

    for block in blocks:
        text = (block.get("text") or "").strip()
        if not text:
            continue
        anchor = (block.get("page"), block.get("heading"))
        if current and current_len + len(text) + 1 > max_chars:
            flush()
        if not current:
            current_anchor = anchor
        current = (current + "\n" + text).strip() if current else text
        current_len = len(current)
        while current_len > max_chars:
            head, tail = _split_fit(current, max_chars)
            chunks.append(Chunk(text=head.strip(), page=current_anchor[0], heading=current_anchor[1]))
            if overlap > 0:
                current = _tail_words(tail, overlap) + " " + tail
            else:
                current = tail
            current_len = len(current)
            # after a mid-block cut, the remainder keeps the same anchor
    flush()
    return chunks


def _split_fit(text: str, max_chars: int) -> tuple[str, str]:
    """Split text at <= max_chars, preferring a sentence boundary, then a word boundary."""
    window = text[:max_chars + 1]
    sentence_cut = 0
    for m in _SENTENCE_END.finditer(window):
        if m.end() <= max_chars:
            sentence_cut = m.end()
    if sentence_cut:
        return text[:sentence_cut], text[sentence_cut:]
    space = window.rfind(" ")
    if space > 0:
        return text[:space], text[space + 1:]
    return text[:max_chars], text[max_chars:]


def _tail_words(text: str, overlap: int) -> str:
    words = text.split()
    out = ""
    for w in reversed(words):
        candidate = (w + " " + out).strip()
        if len(candidate) > overlap:
            break
        out = candidate
    return out
