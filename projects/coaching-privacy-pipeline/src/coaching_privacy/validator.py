"""Independent leak validator, separate from the detector/transform modules (A07, A15).

Fail-closed: unavailable validator or found leaks must never allow approval.
Sanitized reports never echo the raw PII values found.
"""
from __future__ import annotations

from typing import Any


class ValidatorUnavailable(RuntimeError):
    """Mandatory validator could not run; pipeline must return FAILED."""


class IndependentLeakValidator:
    """Checks sanitized output against prohibited leaks.

    Independently configured from the transform stage: it only receives the
    prohibited leak strings (evaluation-only) and sanitized utterances, and it
    re-scans text rather than trusting the transformer's claims.
    """

    def validate(
        self,
        prohibited_leaks: list[str],
        sanitized_utterances: list[dict[str, Any]],
    ) -> dict[str, Any]:
        if not isinstance(sanitized_utterances, list):
            raise ValidatorUnavailable("sanitized utterances missing")
        found: list[dict[str, Any]] = []
        texts = {
            u.get("id", f"u{i}"): u.get("text", "") for i, u in enumerate(sanitized_utterances)
        }
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
        return {
            "validator_available": True,
            "residual_pii": found,
            "leak_count": len(found),
            "utterances_checked": len(texts),
        }
