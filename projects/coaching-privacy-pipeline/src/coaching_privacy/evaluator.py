"""Evaluator: compares sanitized results against evaluation-only gold truth (S1).

Gold labels/subject_id never reach the runtime pipeline; this module is the
only consumer. Reports honest per-category recall with denominators and
counts of prohibited leaks that survived sanitization (A20-scoped).
"""
from __future__ import annotations

import json
import pathlib

from .generator import validate_fixture_record

DIRECT = "DIRECT_PII"
QUASI = "QUASI_IDENTIFIER"
RELATIONAL = "RELATIONAL"


def _category(label: str) -> str:
    return label.split(".", 1)[0]


def evaluate(fixtures_path: pathlib.Path, results_path: pathlib.Path) -> dict:
    fixtures = [
        json.loads(l) for l in fixtures_path.read_text().splitlines() if l.strip()
    ]
    per_category: dict[str, dict[str, int]] = {}
    sessions_evaluated = 0
    leaked_prohibited = 0
    for record in fixtures:
        try:
            validate_fixture_record(record)
        except ValueError as exc:
            raise ValueError(f"malformed fixture {record.get('fixture_id')}: {exc}")
        session_id = record["transcript"]["session_id"]
        result_dir = results_path / session_id
        sanitized_file = result_dir / "sanitized.json"
        if not sanitized_file.is_file():
            raise FileNotFoundError(f"missing processed result for {session_id}")
        sanitized = json.loads(sanitized_file.read_text())
        sessions_evaluated += 1

        # detection recall: gold span values must be absent from sanitized text
        sanitized_text = " ".join(u["text"] for u in sanitized["utterances"])
        for span in record.get("gold_spans", []):
            cat = _category(span["label"])
            m = per_category.setdefault(cat, {"found": 0, "total": 0})
            m["total"] += 1
            if span["gold_value"] not in sanitized_text:
                m["found"] += 1

        # prohibited leaks: must never survive sanitization
        for leak in record.get("prohibited_leaks", []):
            if leak in sanitized_text:
                leaked_prohibited += 1

    recall = {
        cat: {
            "found": m["found"],
            "total": m["total"],
            "recall": round(m["found"] / m["total"], 4) if m["total"] else None,
        }
        for cat, m in sorted(per_category.items())
    }
    return {
        "sessions_evaluated": sessions_evaluated,
        "detection_recall": recall,
        "leaked_prohibited": leaked_prohibited,
    }


def write_reports(summary: dict, output_dir: pathlib.Path) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    (output_dir / "summary.json").write_text(json.dumps(summary, indent=2) + "\n")
    lines = [
        "Coaching Privacy Pipeline - evaluation report (synthetic data only)",
        "=" * 64,
        f"sessions evaluated: {summary['sessions_evaluated']}",
        f"prohibited leaks surviving sanitization: {summary['leaked_prohibited']}",
        "",
        "detection recall per category (gold span removed from sanitized output):",
    ]
    for cat, m in summary["detection_recall"].items():
        lines.append(
            f"  {cat}: {m['found']}/{m['total']} "
            f"(recall {m['recall'] if m['recall'] is not None else 'n/a'})"
        )
    lines.append("")
    lines.append(
        "Note: recall here measures whether gold-annotated values were removed; "
        "it is not proof of anonymity or real-world privacy quality."
    )
    (output_dir / "report.txt").write_text("\n".join(lines) + "\n")
