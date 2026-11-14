"""I9-S1 RED: GLiNER profiling/benchmark tooling absent (issue #9 slice 1)."""
from __future__ import annotations

import json
import pathlib
import subprocess
import sys

import pytest

pytestmark = pytest.mark.slow

REPO = pathlib.Path(__file__).resolve().parents[2]


def test_bench_gliner_produces_profile_and_model_report(tmp_path):
    bench = REPO / "scripts" / "bench_gliner.py"
    out = tmp_path / "gliner_bench.json"
    import os

    # Setup-time benchmark: candidates may download (runtime stays offline).
    env = {**os.environ, "HF_HUB_OFFLINE": "0"}
    r = subprocess.run(
        [sys.executable, str(bench), "--output", str(out),
         "--models", "urchade/gliner_medium-v2.1", "urchade/gliner_small-v2.1"],
        capture_output=True, text=True, cwd=REPO, timeout=3000, env=env,
    )
    assert r.returncode == 0, (r.stdout, r.stderr)
    report = json.loads(out.read_text())
    assert "profile" in report, "missing wall-time profile"
    assert {"load_s", "inference_s"} <= set(report["profile"]), report["profile"]
    models = {e["model"] for e in report["results"]}
    assert "urchade/gliner_medium-v2.1" in models, report
    assert "urchade/gliner_small-v2.1" in models, report
    for entry in report["results"]:
        assert entry.get("avg_latency_s", 0) > 0, entry
        recall = entry.get("per_category_recall", {})
        assert recall, "per-category recall required"
        for cat, r_ in recall.items():
            assert 0.0 <= r_ <= 1.0, (cat, r_)
    assert report.get("sessions", 0) >= 100, "large seeded set required"


def test_seeded_benchmark_fixture_exists():
    """A >= 200-session seeded fixture set for meaningful timing."""
    path = REPO / "fixtures" / "bench_gliner_sessions.jsonl"
    assert path.is_file(), "seeded benchmark fixture missing"
    lines = [l for l in path.read_text().splitlines() if l.strip()]
    assert len(lines) >= 200, len(lines)
