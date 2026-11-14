"""I10-S1 RED: review-rate analysis tooling absent (issue #10 slice 1)."""
from __future__ import annotations

import json
import pathlib
import subprocess
import sys

import pytest

pytestmark = pytest.mark.slow

REPO = pathlib.Path(__file__).resolve().parents[2]


def test_review_analysis_report(tmp_path):
    script = REPO / "scripts" / "review_analysis.py"
    out = tmp_path / "analysis.json"
    r = subprocess.run(
        [sys.executable, str(script), "--output", str(out)],
        capture_output=True, text=True, cwd=REPO, timeout=2400,
    )
    assert r.returncode == 0, (r.stdout, r.stderr)
    report = json.loads(out.read_text())
    sessions = report["sessions"]
    assert len(sessions) == 18, "all 18 fixtures required"
    classification = set()
    for s in sessions:
        assert s["fixture_id"].startswith("seed-")
        assert s["expected"] in {"RELEASE_CANDIDATE", "REVIEW_REQUIRED"}
        assert s["actual"] in {"RELEASE_CANDIDATE", "REVIEW_REQUIRED", "BLOCKED", "FAILED"}
        assert s["classification"] in {
            "correct", "false-REVIEW", "false-RELEASE", "known-gap",
        }
        classification.add(s["classification"])
        if s["actual"] != "RELEASE_CANDIDATE" or s["expected"] != "RELEASE_CANDIDATE":
            assert s.get("reasons") or s.get("context_labels"), s
    summary = report["summary"]
    assert {"correct", "false-REVIEW", "false-RELEASE", "known-gap"} <= set(summary)
    benign = [s for s in sessions if s["expected"] == "RELEASE_CANDIDATE"]
    risky = [s for s in sessions if s["expected"] == "REVIEW_REQUIRED"]
    assert len(benign) == 6 and len(risky) == 12
