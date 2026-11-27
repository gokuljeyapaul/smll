"""The citation machinery (A05): extract <ref> citations from a Pleias-style answer,
verify each quoted span is a verbatim substring of the cited chunk, and drop the
unverifiable ones while marking their claims unsupported."""
from __future__ import annotations

import re
from dataclasses import dataclass, field

# <ref name="3">…</ref> and <ref name="<|source_id|>3">…</ref>
CITATION_RE = re.compile(r'<ref name="(?:<\|source_id\|>)?(\d+)">(.*?)</ref>', re.DOTALL)


def _normalize(text: str) -> str:
    """Collapse whitespace runs to single spaces. Quote content stays literal otherwise."""
    return re.sub(r"\s+", " ", text).strip()


@dataclass
class Citation:
    source_id: int
    quote: str
    verified: bool = False
    display_number: int | None = None


@dataclass
class VerifiedAnswer:
    clean_text: str
    citations: list[Citation]
    unsupported_claims: list[str] = field(default_factory=list)
    dropped_citations: int = 0


def extract_citations(answer_text: str) -> list[Citation]:
    return [Citation(source_id=int(m.group(1)), quote=m.group(2).strip())
            for m in CITATION_RE.finditer(answer_text)]


def verify_citation(quote: str, chunk_text: str) -> bool:
    """A05: a displayed citation's quote must be a verbatim substring of the cited chunk."""
    return _normalize(quote) in _normalize(chunk_text) and len(_normalize(quote)) > 0


def strip_ref_tags(answer_text: str) -> str:
    return CITATION_RE.sub("", answer_text).strip()


def apply_citation_verifier(answer_text: str, chunks_by_source_id: dict[int, str]) -> VerifiedAnswer:
    """Verify every citation in an answer against the chunk it cites.

    Verified citations keep their claim; an unverifiable citation is REMOVED from the
    display set and its claim is marked unsupported. Chunks not in the map count as
    unverifiable (fail closed)."""
    citations: list[Citation] = []
    unsupported: list[str] = []
    dropped = 0
    matches = list(CITATION_RE.finditer(answer_text))
    for m in matches:
        c = Citation(source_id=int(m.group(1)), quote=m.group(2).strip())
        chunk = chunks_by_source_id.get(c.source_id)
        ok = chunk is not None and verify_citation(c.quote, chunk)
        c.verified = ok
        citations.append(c)
        if not ok:
            dropped += 1
            claim = _claim_around_span(answer_text, m.start(), m.end())
            if claim and claim not in unsupported:
                unsupported.append(claim)
    # display numbers in order of appearance among the verified citations; the clean
    # text keeps a [n] marker where a verified citation was; every ref tag (verified
    # or not) is dropped from the display text, and unverifiable ones are gone entirely
    n = 0
    clean_parts: list[str] = []
    last = 0
    for m, c in zip(matches, citations, strict=False):
        clean_parts.append(answer_text[last:m.start()])
        if c.verified:
            n += 1
            c.display_number = n
            clean_parts.append(f"[{n}]")
        last = m.end()
    clean_parts.append(answer_text[last:])
    clean_text = _normalize("".join(clean_parts))
    return VerifiedAnswer(clean_text=clean_text, citations=citations,
                          unsupported_claims=unsupported, dropped_citations=dropped)


def _claim_around_span(text: str, start: int, end: int) -> str:
    """The sentence the citation at [start, end) belongs to, with ref tags stripped.
    Refs sit either inside the sentence or right after its terminator — both shapes
    resolve to the same sentence."""
    left = text[:start]
    prev_ends = [p for p in (left.rfind("."), left.rfind("!"), left.rfind("?")) if p >= 0]
    if prev_ends and start - max(prev_ends) <= 2:
        # the ref follows the sentence terminator: the claim is the sentence that just ended
        e = max(prev_ends) + 1
        before = left[:max(prev_ends)]
        starts = [p for p in (before.rfind("."), before.rfind("!"), before.rfind("?")) if p >= 0]
        s = max(starts) + 1 if starts else 0
    else:
        s = max(prev_ends) + 1 if prev_ends else 0
        right = text[end:]
        ends = [p for p in (right.find("."), right.find("!"), right.find("?")) if p >= 0]
        e = end + (min(ends) + 1 if ends else len(right))
    return _normalize(strip_ref_tags(text[s:e]))
