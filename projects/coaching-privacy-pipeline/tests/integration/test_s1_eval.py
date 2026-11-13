"""S1 integration tests: data isolation between runtime and evaluator (A05)."""
import json
import pytest
import pathlib
import subprocess

pytestmark = pytest.mark.slow

PROJECT = pathlib.Path(__file__).resolve().parents[2]
VENV_BIN = PROJECT / ".venv" / "bin"


def test_processed_results_contain_no_gold_labels(tmp_path):
    """The processor output must never embed gold labels/subject_id (leakage isolation)."""
    import sys
    sys.path.insert(0, str(PROJECT / "src"))
    from coaching_privacy.contracts import Transcript
    from coaching_privacy.engine import process_transcript
    from coaching_privacy.policy import PolicyStore

    fixtures = tmp_path / "dev.jsonl"
    subprocess.run(
        [str(VENV_BIN / "privacy-fixtures"), "generate", "--seed", "42",
         "--sessions", "5", "--output", str(fixtures)],
        check=True, capture_output=True,
    )
    store = PolicyStore(PROJECT / "policies" / "sample_policy.yaml")
    policy = store.get("internal_coaching_analysis")
    for line in fixtures.read_text().splitlines():
        rec = json.loads(line)
        result = process_transcript(
            Transcript.parse(rec["transcript"]), policy,
            prohibited_leaks=rec.get("prohibited_leaks"),
        )
        blob = json.dumps(result.sanitized) + json.dumps(result.report)
        assert "gold" not in blob
        assert rec["subject_id"] not in blob


def test_eval_run_reports_detection_recall_against_gold(tmp_path):
    """privacy-eval run compares results with evaluation-only gold and reports
    real recall per category with denominators (A20-scoped)."""
    fixtures = tmp_path / "dev.jsonl"
    results = tmp_path / "results"
    reports = tmp_path / "reports"
    subprocess.run(
        [str(VENV_BIN / "privacy-fixtures"), "generate", "--seed", "42",
         "--sessions", "20", "--output", str(fixtures)],
        check=True, capture_output=True,
    )
    subprocess.run(
        [str(VENV_BIN / "privacy-pipeline"), "process",
         "--input", str(fixtures), "--policy", "internal_coaching_analysis",
         "--output", str(results)],
        check=True, capture_output=True,
    )
    r = subprocess.run(
        [str(VENV_BIN / "privacy-eval"), "run",
         "--fixtures", str(fixtures), "--results", str(results),
         "--output", str(reports)],
        capture_output=True, text=True,
    )
    assert r.returncode == 0, r.stderr
    summary = json.loads((reports / "summary.json").read_text())
    # per-category recall with denominators present
    assert "detection_recall" in summary
    for cat, m in summary["detection_recall"].items():
        assert "found" in m and "total" in m, cat
        assert m["total"] > 0
    # honest counting: forbidden leaks in sanitized output counted
    assert "leaked_prohibited" in summary and summary["leaked_prohibited"] == 0
    text = (reports / "report.txt").read_text()
    assert "recall" in text.lower()
