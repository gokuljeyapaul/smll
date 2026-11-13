"""Independent leak validator, separate from the detector/transform modules (A07, A15).

Fail-closed: unavailable validator or found leaks must never allow approval.
Sanitized reports never echo the raw PII values found.

I22: the validator now performs its own second pass, independent of the
detector/transformer:

1. **Structured-identifier rescan** — deterministic regex rules for email,
   phone numbers, URLs/@handles, IPv4, card numbers (Luhn) and long
   digit/ID-like tokens.
2. **Echo check** — every raw value the detector replaced in this run must
   not re-appear in the sanitized text (faulty re-insertion detection).

Honest scope: this is a second mechanism, NOT a completeness guarantee.
Known blind spots (documented, by design for a non-generative PoC): person
names not matching the replaced-values list, contextual/quasi-identifier
combinations (covered by the GLiNER context stage), free-text attributes and
non-English patterns. Findings record label + length + utterance id only;
raw values never enter reports, logs or errors.
"""
from __future__ import annotations

import re
from typing import Any


class ValidatorUnavailable(RuntimeError):
    """Mandatory validator could not run; pipeline must return FAILED."""


# Deterministic structured-identifier patterns (I22). Kept conservative to
# bound false positives; a fail-closed bias is documented in the status ledger.
_PATTERNS: list[tuple[str, re.Pattern[str]]] = [
    ("EMAIL", re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")),
    ("URL", re.compile(r"https?://[^\s<>\"']+")),
    ("IPV4", re.compile(
        r"(?<![\d.])(?:\d{1,3}\.){3}\d{1,3}(?![\d.])"
    )),
    # North-American style and loose international phone forms.
    ("PHONE", re.compile(
        r"(?<![\d-])(?:\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]\d{3}[-.\s]?\d{4}(?![\d-])"
    )),
    ("HANDLE", re.compile(r"(?<![\w@])@[A-Za-z0-9_]{3,}(?![\w@])")),
]

_LUHN_GROUP = re.compile(r"\b(?:\d[ -]?){13,19}\b")
_DIGIT_TOKEN = re.compile(r"(?<![\w-])\d{7,}(?![\w-])")


def _luhn_ok(candidate: str) -> bool:
    digits = re.sub(r"[^0-9]", "", candidate)
    if not (13 <= len(digits) <= 19) or not digits.isdigit():
        return False
    total, alt = 0, False
    for ch in reversed(digits):
        d = ord(ch) - 48
        if alt:
            d *= 2
            if d > 9:
                d -= 9
        total += d
        alt = not alt
    return total % 10 == 0


def _digit_run(s: str) -> bool:
    digits = re.sub(r"[\s-]", "", s)
    return digits.isdigit() and 13 <= len(digits) <= 19


class IndependentLeakValidator:
    """Independent second pass over sanitized output.

    Checks (a) the evaluation-only prohibited-leak list, (b) deterministic
    structured-identifier patterns, and (c) that no value replaced by the
    transformer re-appears (echo check). It does not trust the transformer's
    claims — but it is also not a completeness guarantee (see module docstring).
    """

    def validate(
        self,
        prohibited_leaks: list[str],
        sanitized_utterances: list[dict[str, Any]],
        replaced_values: list[str] | None = None,
    ) -> dict[str, Any]:
        if not isinstance(sanitized_utterances, list):
            raise ValidatorUnavailable("sanitized utterances missing")
        found: list[dict[str, Any]] = []
        texts = {
            u.get("id", f"u{i}"): u.get("text", "") for i, u in enumerate(sanitized_utterances)
        }
        # (a) evaluation-only gold list (unchanged behavior).
        for leak in prohibited_leaks or []:
            for utterance_id, text in texts.items():
                if leak and leak in text:
                    # Record a redacted hint, never the raw PII value itself.
                    found.append(
                        {
                            "utterance_id": utterance_id,
                            "leak_label": "PROHIBITED_IDENTIFIER",
                            "leak_length": len(leak),
                        }
                    )
        # (b) structured-identifier rescan (I22).
        for utterance_id, text in texts.items():
            for label, pattern in _PATTERNS:
                for m in pattern.finditer(text):
                    value = m.group(0)
                    if label == "PHONE" and not _has_phone_shape(value):
                        continue
                    found.append(
                        {
                            "utterance_id": utterance_id,
                            "leak_label": f"STRUCTURED_{label}",
                            "leak_length": len(value),
                        }
                    )
            for m in _LUHN_GROUP.finditer(text):
                if _luhn_ok(m.group(0)) and _digit_run(m.group(0)):
                    found.append(
                        {
                            "utterance_id": utterance_id,
                            "leak_label": "STRUCTURED_CARD",
                            "leak_length": len(m.group(0)),
                        }
                    )
            for m in _DIGIT_TOKEN.finditer(text):
                found.append(
                    {
                        "utterance_id": utterance_id,
                        "leak_label": "STRUCTURED_LONG_ID",
                        "leak_length": len(m.group(0)),
                    }
                )
        # (c) echo check (I22): replaced raw values must not survive.
        for value in replaced_values or []:
            if not value:
                continue
            for utterance_id, text in texts.items():
                if value in text:
                    found.append(
                        {
                            "utterance_id": utterance_id,
                            "leak_label": "REPLACED_VALUE_ECHO",
                            "leak_length": len(value),
                        }
                    )
        return {
            "validator_available": True,
            "residual_pii": found,
            "leak_count": len(found),
            "utterances_checked": len(texts),
            "validator_scope": (
                "second-pass structured-identifier rescan + replaced-value echo check; "
                "not a completeness guarantee (names/context blind spots documented)"
            ),
        }


def _has_phone_shape(value: str) -> bool:
    digits = re.sub(r"\D", "", value)
    return 10 <= len(digits) <= 14 and (len(digits) >= 10)
