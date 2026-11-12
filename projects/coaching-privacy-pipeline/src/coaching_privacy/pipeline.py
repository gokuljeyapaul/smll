"""Safety gate implementing the PoC decision rules (fail-closed).

Status rules (verbatim from BUILD_PLAN):
    missing purpose / processing error / validator unavailable -> FAILED
    residual known critical PII or confirmed identifiable context -> BLOCKED
    uncertain high risk / unsupported language / external_sharing -> REVIEW_REQUIRED
    mandatory synthetic acceptance tests pass -> RELEASE_CANDIDATE
"""
from __future__ import annotations

from typing import Any

VALID_DECISIONS = {"RELEASE_CANDIDATE", "REVIEW_REQUIRED", "BLOCKED", "FAILED"}


class SafetyGate:
    def decide(self, report: dict[str, Any], purpose: str) -> dict[str, Any]:
        reasons: list[str] = []

        if report.get("validator_available") is False:
            return self._decision("FAILED", ["validator_unavailable"])
        if report.get("error"):
            return self._decision("FAILED", ["processing_error"])

        if report.get("residual_pii"):
            return self._decision("BLOCKED", ["confirmed_residual_pii"])

        if purpose == "external_sharing":
            return self._decision("REVIEW_REQUIRED", ["external_sharing_requires_human_release"])

        if not report.get("all_mandatory_stages_executed", False):
            return self._decision("REVIEW_REQUIRED", ["mandatory_stages_incomplete"])

        if report.get("asr_uncertain"):
            # No silent release of ambiguous audio-derived transcripts (A13/S5).
            return self._decision("REVIEW_REQUIRED", ["asr_uncertainty_requires_review"])

        if report.get("context_risks"):
            return self._decision("REVIEW_REQUIRED", ["uncertain_context_risk"])

        return self._decision(
            "RELEASE_CANDIDATE",
            ["synthetic_internal_acceptance_passed; not permission to distribute"],
        )

    @staticmethod
    def _decision(decision: str, reasons: list[str]) -> dict[str, Any]:
        assert decision in VALID_DECISIONS
        return {"decision": decision, "review_reasons": reasons}
