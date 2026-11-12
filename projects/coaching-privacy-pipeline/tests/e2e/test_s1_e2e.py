"""S1 E2E: generate -> process -> eval pipeline on aligned same-seed data (A19)."""
import json
import pathlib
import subprocess

PROJECT = pathlib.Path(__file__).resolve().parents[2]
VENV_BIN = PROJECT / ".venv" / "bin"


def test_generate_process_eval_e2e(tmp_path):
    dev = tmp_path / "dev.jsonl"
    results = tmp_path / "dev_results"
    reports = tmp_path / "dev_reports"

    g = subprocess.run(
        [str(VENV_BIN / "privacy-fixtures"), "generate",
         "--seed", "42", "--sessions", "25", "--output", str(dev)],
        capture_output=True, text=True,
    )
    assert g.returncode == 0, g.stderr
    assert dev.is_file() and len(dev.read_text().splitlines()) == 25

    p = subprocess.run(
        [str(VENV_BIN / "privacy-pipeline"), "process",
         "--input", str(dev), "--policy", "internal_coaching_analysis",
         "--output", str(results)],
        capture_output=True, text=True,
    )
    assert p.returncode == 0, p.stderr

    e = subprocess.run(
        [str(VENV_BIN / "privacy-eval"), "run",
         "--fixtures", str(dev), "--results", str(results),
         "--output", str(reports)],
        capture_output=True, text=True,
    )
    assert e.returncode == 0, e.stderr
    summary = json.loads((reports / "summary.json").read_text())
    assert summary["sessions_evaluated"] == 25


def test_malformed_fixture_fails_eval_closed(tmp_path):
    fixtures = tmp_path / "bad.jsonl"
    fixtures.write_text(json.dumps({"broken": "record"}) + "\n")
    r = subprocess.run(
        [str(VENV_BIN / "privacy-eval"), "run",
         "--fixtures", str(fixtures), "--results", str(tmp_path / "r"),
         "--output", str(tmp_path / "o")],
        capture_output=True, text=True,
    )
    assert r.returncode != 0
