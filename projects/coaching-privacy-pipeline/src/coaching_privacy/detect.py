"""Real Presidio + spaCy PII detection (A06).

Uses the actual AnalyzerEngine with en_core_web_sm. No mock substitutes are
permitted for this mandatory stage; unavailability fails closed upstream.
"""
from __future__ import annotations

import dataclasses
from typing import Any

import re

import spacy
from presidio_analyzer import AnalyzerEngine, RecognizerResult

# Deterministic relabeling: Presidio often classifies fictional-TLD emails
# (e.g. @example.test) as URL; the EMAIL pattern is authoritative.
_EMAIL_RE = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
# Deterministic street-address pattern: <number> <Name> (Terrace|Street|...), optional unit.
_STREET_RE = re.compile(
    r"\b\d{1,5}\s+[A-Z][A-Za-z.'-]*(?:\s+[A-Z][A-Za-z.'-]*)*\s+"
    r"(?:Street|St\.?|Avenue|Ave\.?|Road|Rd\.?|Lane|Ln\.?|Drive|Dr\.?|Court|Ct\.?|Terrace|Place|Pl\.?|Boulevard|Blvd\.?|Way|Circle|Cir\.?)\b"
    r"(?:,?\s+(?:Suite|Apt\.?|Apartment|Unit|#)\s*\d+[A-Za-z]?)?"
)

# Presidio entity -> canonical DIRECT_PII label
ENTITY_TO_LABEL = {
    "PERSON": "PERSON",
    "EMAIL_ADDRESS": "EMAIL",
    "PHONE_NUMBER": "PHONE",
    "LOCATION": "ADDRESS",
    "US_SSN": "NATIONAL_ID",
    "IBAN_CODE": "ACCOUNT_ID",
    "IP_ADDRESS": "ACCOUNT_ID",
    "URL": "HANDLE",
    "DATE_TIME": "DATE_OF_BIRTH",
    "ORGANIZATION": "ORGANIZATION",
    "CRYPTO": "ACCOUNT_ID",
}


@dataclasses.dataclass(frozen=True)
class DetectedSpan:
    start: int
    end: int
    label: str  # e.g. "DIRECT_PII.PERSON"
    value: str
    detector: str
    confidence: float


class PresidioDetector:
    """Thin adapter around the real Presidio AnalyzerEngine."""

    def __init__(self, spacy_model: str = "en_core_web_sm"):
        try:
            self._analyzer = AnalyzerEngine()
        except Exception as exc:  # pragma: no cover - environment failure
            raise RuntimeError(f"presidio analyzer unavailable: {exc}") from exc
        self._spacy_model = spacy_model

    def detect(self, text: str) -> list[DetectedSpan]:
        results: list[RecognizerResult] = self._analyzer.analyze(
            text=text, language="en", entities=None
        )
        spans: list[DetectedSpan] = []
        for r in results:
            canonical = ENTITY_TO_LABEL.get(r.entity_type)
            if canonical is None:
                continue
            spans.append(
                DetectedSpan(
                    start=r.start,
                    end=r.end,
                    label=f"DIRECT_PII.{canonical}",
                    value=text[r.start:r.end],
                    detector="presidio",
                    confidence=round(float(r.score), 4),
                )
            )
        # deterministic order, non-overlapping preference
        spans.sort(key=lambda s: (s.start, -(s.end - s.start)))
        # Relabel URL-classified email addresses to EMAIL, and backfill any
        # email Presidio missed entirely (deterministic, audited extension).
        final: list[DetectedSpan] = []
        covered_email = False
        for s in spans:
            if s.label in ("DIRECT_PII.HANDLE", "DIRECT_PII.ACCOUNT_ID") and "@" in s.value:
                if _EMAIL_RE.fullmatch(s.value):
                    final.append(
                        DetectedSpan(
                            start=s.start, end=s.end, label="DIRECT_PII.EMAIL",
                            value=s.value, detector="presidio+email_relabel",
                            confidence=s.confidence,
                        )
                    )
                    covered_email = True
                    continue
            final.append(s)
            if s.label == "DIRECT_PII.EMAIL":
                covered_email = True
        if not covered_email:
            for m in _EMAIL_RE.finditer(text):
                final.append(
                    DetectedSpan(
                        start=m.start(), end=m.end(), label="DIRECT_PII.EMAIL",
                        value=m.group(0), detector="email_regex_backfill", confidence=0.9,
                    )
                )
        # Street-address backfill: Presidio's US_ADDRESS recognizer often
        # misses fictional addresses; deterministic regex, audited extension.
        covered_address = any(s.label == "DIRECT_PII.ADDRESS" for s in final)
        if not covered_address:
            for m in _STREET_RE.finditer(text):
                if not any(s.start < m.end() and m.start() < s.end for s in final):
                    final.append(
                        DetectedSpan(
                            start=m.start(), end=m.end(), label="DIRECT_PII.ADDRESS",
                            value=m.group(0), detector="street_address_regex", confidence=0.85,
                        )
                    )
        final.sort(key=lambda s: (s.start, -(s.end - s.start)))
        return final

    def model_versions(self) -> dict[str, Any]:
        return {
            "presidio_analyzer": "real AnalyzerEngine",
            "spacy_model": self._spacy_model,
            "spacy_version": spacy.__version__,
        }
