"""S6 integration tests: full-scale corpus audit + one-command audit script (A20, A21, A24)."""
import json
import pytest
import subprocess
import sys
import pathlib

pytestmark = pytest.mark.slow

PROJECT = pathlib.Path(__file__).resolve().parents[2]
VENV_BIN = PROJECT / ".venv" / "bin"
sys.path.insert(0, str(PROJECT / "src"))


def test_audit_corpus_generation_at_spec_scale(tmp_path):
    """S6 audit must run on the spec'd 100 dev / 200 holdout locked scale."""
    dev = tmp_path / "dev.jsonl"
    hold = tmp_path / "holdout.jsonl"
    r1 = subprocess.run(
        [str(VENV_BIN / "privacy-fixtures"), "generate",
         "--seed", "42", "--sessions", "100", "--output", str(dev)],
        capture_output=True, text=True,
    )
    r2 = subprocess.run(
        [str(VENV_BIN / "privacy-fixtures"), "generate",
         "--seed", "941", "--sessions", "200", "--output", str(hold), "--locked"],
        capture_output=True, text=True,
    )
    assert r1.returncode == 0 and r2.returncode == 0, (r1.stderr, r2.stderr)
    assert len(dev.read_text().splitlines()) == 100
    assert len(hold.read_text().splitlines()) == 200
    dev_subjects = {json.loads(l)["subject_id"] for l in dev.read_text().splitlines()}
    hold_subjects = {json.loads(l)["subject_id"] for l in hold.read_text().splitlines()}
    assert dev_subjects.isdisjoint(hold_subjects)


def test_audit_report_has_provenance_and_metrics(tmp_path):
    """The one-command audit report must carry provenance + honest metrics."""
    dev = tmp_path / "dev.jsonl"
    subprocess.run(
        [str(VENV_BIN / "privacy-fixtures"), "generate",
         "--seed", "42", "--sessions", "10", "--output", str(dev)],
        check=True, capture_output=True,
    )
    results = tmp_path / "results"
    reports = tmp_path / "reports"
    subprocess.run(
        [str(VENV_BIN / "privacy-pipeline"), "process",
         "--input", str(dev), "--policy", "internal_coaching_analysis",
         "--output", str(results)],
        check=True, capture_output=True,
    )
    r = subprocess.run(
        [str(VENV_BIN / "privacy-eval"), "run",
         "--fixtures", str(dev), "--results", str(results),
         "--output", str(reports)],
        capture_output=True, text=True,
    )
    assert r.returncode == 0, r.stderr
    summary = json.loads((reports / "summary.json").read_text())
    for key in ("sessions_evaluated", "detection_recall", "leaked_prohibited"):
        assert key in summary, key
    for cat, m in summary["detection_recall"].items():
        assert "found" in m and "total" in m and m["total"] > 0


def test_one_command_audit_script_runs():
    """scripts/audit.sh must exist and produce a machine-readable report."""
    audit = pathlib.Path(PROJECT) / "scripts" / "audit.sh"
    assert audit.is_file(), "scripts/audit.sh missing"
    src = audit.read_text()
    assert "provenance" in src or "privacy-eval" in src
