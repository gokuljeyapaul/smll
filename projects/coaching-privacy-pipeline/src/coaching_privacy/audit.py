"""Audit tooling (S6): provenance, log PII scanning, gold-leak verification (A20, A21, A23)."""
from __future__ import annotations

import datetime
import json
import platform
from typing import Any


def build_provenance(
    pipeline_version: str,
    dataset_seed: int,
    models: dict[str, str],
    policy: str,
) -> dict[str, Any]:
    """Full provenance for every artifact (A20): versions, seed, models, policy,
    timestamp, host. Deterministic given inputs except the timestamp."""
    return {
        "pipeline_version": pipeline_version,
        "dataset_seed": dataset_seed,
        "models": dict(models),
        "policy": policy,
        "timestamp_utc": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "host": {
            "machine": platform.machine(),
            "python": platform.python_version(),
            "system": platform.system(),
        },
    }


def scan_logs_for_pii(
    logs: list[str], prohibited: list[str]
) -> list[dict[str, Any]]:
    """Deterministic scan of log lines for prohibited raw values (A23).

    The pipeline is designed to never log raw PII; this audit proves it.
    Returns findings with line indexes and the offending line.
    """
    findings: list[dict[str, Any]] = []
    for idx, line in enumerate(logs):
        for value in prohibited:
            if value and value in line:
                findings.append(
                    {
                        "line_index": idx,
                        "line": line,
                        "matched": value,
                    }
                )
                break  # one finding per line
    return findings


def assert_no_gold_in_artifacts(
    artifacts: dict[str, Any], gold_values: list[str]
) -> None:
    """Release artifacts must never contain gold labels (A21). Fails closed."""
    blob = json.dumps(artifacts)
    for value in gold_values:
        if value and value in blob:
            raise AssertionError(
                f"gold value present in release artifact: {value!r}"
            )
