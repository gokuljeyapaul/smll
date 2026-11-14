"""I11-S2 RED: no German fixtures; no multilingual evaluation (issue #11 slice 2)."""
from __future__ import annotations

import json
import pathlib

import pytest

pytestmark = pytest.mark.slow

REPO = pathlib.Path(__file__).resolve().parents[2]


def test_german_fixture_suite_exists():
    path = REPO / "fixtures" / "german_fixtures.jsonl"
    assert path.is_file(), "German fixture suite missing"
    lines = [l for l in path.read_text().splitlines() if l.strip()]
    assert len(lines) >= 10, len(lines)
    for line in lines:
        record = json.loads(line)
        from coaching_privacy.generator import validate_fixture_record

        validate_fixture_record(record)  # gold spans consistent by construction
        assert record["transcript"]["language"] == "de"
        assert record["gold_spans"], "German sessions need gold spans"


def test_eval_report_has_german_per_category_pr():
    """The committed evaluation report has German per-category P/R and an
    honest gate decision (German shipped in SUPPORTED_LANGUAGES only if the
    mandatory-category recall equals the English bar; otherwise the gate
    stays and the evaluation is the deliverable)."""
    report_path = REPO / "docs" / "evidence" / "I11-S2" / "german_eval.json"
    assert report_path.is_file(), "German evaluation report missing"
    report = json.loads(report_path.read_text())
    assert report["language"] == "de"
    assert "per_category" in report
    assert report["per_category"], "per-category P/R required"
    assert "gate_decision" in report
    assert report["gate_decision"] in {
        "german_added_to_supported",
        "gate_retained_evaluation_only",
    }
    assert "caveat" in report  # synthetic-only honesty note
