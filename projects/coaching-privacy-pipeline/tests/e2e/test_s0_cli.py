"""S0 E2E tests: CLI processing of a seed fixture (A17/A19-relevant, S0 scope)."""
import json
import pytest
import pathlib
import subprocess
import sys

pytestmark = pytest.mark.slow

PROJECT = pathlib.Path(__file__).resolve().parents[2]
VENV_BIN = PROJECT / ".venv" / "bin"
FIXTURES = PROJECT / "fixtures"


def run_cli(args, cwd=None):
    return subprocess.run(
        [str(VENV_BIN / "privacy-pipeline")] + args,
        capture_output=True, text=True, cwd=cwd,
    )


def _write_single_fixture_input(tmp_path):
    line = (FIXTURES / "seed_fixtures.jsonl").read_text().splitlines()[0]
    input_file = tmp_path / "input.jsonl"
    input_file.write_text(line + "\n")
    return input_file


def test_process_happy_path_produces_decision_and_sanitized_output(tmp_path):
    input_file = _write_single_fixture_input(tmp_path)
    out_dir = tmp_path / "results"
    result = run_cli([
        "process",
        "--input", str(input_file),
        "--policy", "internal_coaching_analysis",
        "--output", str(out_dir),
    ])
    assert result.returncode == 0, result.stderr
    sanitized = json.loads((out_dir / "fictional-S01" / "sanitized.json").read_text())
    assert sanitized["session_id"] == "fictional-S01"
    text = " ".join(u["text"] for u in sanitized["utterances"])
    assert "Mira Solen" not in text
    assert "mira.solen@example.test" not in text
    # coach/client turn order preserved (A08)
    assert [u["id"] for u in sanitized["utterances"]] == ["u1", "u2"]
    decision = json.loads((out_dir / "fictional-S01" / "decision.json").read_text())
    assert decision["decision"] in {
        "RELEASE_CANDIDATE", "REVIEW_REQUIRED", "BLOCKED", "FAILED",
    }
    report = json.loads((out_dir / "fictional-S01" / "validation_report.json").read_text())
    assert report["model_versions"]["spacy_model"] == "en_core_web_sm"


def test_malformed_purpose_cli_fails_nonzero(tmp_path):
    input_file = _write_single_fixture_input(tmp_path)
    record = json.loads(input_file.read_text())
    record["transcript"]["purpose"] = "not_a_real_purpose"
    bad = tmp_path / "bad.jsonl"
    bad.write_text(json.dumps(record) + "\n")
    result = run_cli([
        "process", "--input", str(bad),
        "--policy", "internal_coaching_analysis",
        "--output", str(tmp_path / "out"),
    ])
    assert result.returncode != 0
