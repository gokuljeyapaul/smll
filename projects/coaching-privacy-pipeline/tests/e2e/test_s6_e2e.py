"""S6 E2E: one-command audit produces an honest, provenance-complete report (A24)."""
import json
import pytest
import subprocess
import pathlib

pytestmark = pytest.mark.slow

PROJECT = pathlib.Path(__file__).resolve().parents[2]


def test_audit_command_e2e(tmp_path):
    """bash scripts/audit.sh must run end-to-end and emit audit_report.json."""
    r = subprocess.run(
        ["bash", str(PROJECT / "scripts" / "audit.sh")],
        capture_output=True, text=True, cwd=str(PROJECT),
        timeout=3000,
        env={
            **__import__("os").environ,
            "AUDIT_SESSIONS": "12",  # small scale for test runtime; spec scale in docs
        },
    )
    assert r.returncode == 0, r.stdout[-2000:] + r.stderr[-2000:]
    report_path = PROJECT / "artifacts" / "audit" / "audit_report.json"
    assert report_path.is_file(), "audit_report.json not produced"
    report = json.loads(report_path.read_text())
    for key in ("provenance", "metrics"):
        assert key in report, key
    prov = report["provenance"]
    for key in ("pipeline_version", "dataset_seed", "models", "policy", "timestamp_utc"):
        assert key in prov, key
    metrics = report["metrics"]
    assert "sessions_evaluated" in metrics
    assert metrics["sessions_evaluated"] >= 1
    # honesty: no fabricated perfect scores; recall entries carry denominators
    for cat, m in metrics.get("detection_recall", {}).items():
        assert m["total"] > 0
        assert 0.0 <= m["found"] <= m["total"]
