"""I16 RED: fast/slow markers do not exist — behavioral failures via pytester.

Uses pytest's `pytester` fixture to run mini-suites that exercise the
required marker discipline; all fail today because no markers/conftest
guard exists.
"""
from __future__ import annotations

import pathlib

import pytest

pytestmark = pytest.mark.slow

pytest_plugins = ["pytester"]  # enables the pytester fixture for mini-suites

REPO = pathlib.Path(__file__).resolve().parents[2]

MARKER_PYPROJECT = """
[tool.pytest.ini_options]
markers = ["fast: no model inference", "slow: real model inference"]
"""

CONFTEST = pathlib.Path(__file__).resolve().parents[1] / "conftest.py"


def _marker_setup(pytester, marker_line: str):
    (pytester.path / "pyproject.toml").write_text(
        MARKER_PYPROJECT
        + "\n[project]\nname='x'\nversion='0'\n"
    )
    # Reuse the real conftest guard logic once it exists; before that, the
    # real project conftest is absent here, which is the RED condition.
    src = CONFTEST
    if src.is_file():
        (pytester.path / "conftest.py").write_text(src.read_text())
    else:
        (pytester.path / "conftest.py").write_text("")  # no guard yet
    return marker_line


def test_unmarked_test_fails_collection(pytester):
    _marker_setup(pytester, "")
    (pytester.path / "test_x.py").write_text("def test_x(): assert True\n")
    result = pytester.runpytest_subprocess("-p", "no:cacheprovider")
    result.assert_outcomes(failed=0)
    assert result.ret != 0, "unmarked test must fail the run (marker discipline)"
    combined = result.stdout.str() + result.stderr.str()
    assert "exactly one" in combined and "fast/slow" in combined, combined


def test_double_marked_test_fails_collection(pytester):
    _marker_setup(pytester, "")
    (pytester.path / "test_x.py").write_text(
        'import pytest\n'
        '@pytest.mark.fast\n@pytest.mark.slow\ndef test_x(): assert True\n'
    )
    result = pytester.runpytest_subprocess("-p", "no:cacheprovider")
    assert result.ret != 0, "double-marked test must fail the run"


def test_fast_test_touching_model_loader_fails_guard(pytester, monkeypatch):
    _marker_setup(pytester, "")
    # A fast test that triggers the GLiNER loader must fail with the guard
    # message (the real package path is added so the guard's patches apply).
    (pytester.path / "test_x.py").write_text(
        'import pytest\n'
        'import os\n'
        'os.environ.setdefault("COACHING_GLINER_PATH", '
        f'"{REPO / "models" / "gliner_medium-v2.1"}")\n'
        '@pytest.mark.fast\n'
        'def test_x():\n'
        '    from coaching_privacy.context_extractor import GLiNERContextExtractor\n'
        '    GLiNERContextExtractor()._ensure_loaded()\n'
    )
    import os
    import subprocess
    import sys
    env = {**os.environ, "PYTHONPATH": str(REPO / "src")}
    proc = subprocess.run(
        [sys.executable, "-m", "pytest", "-p", "no:cacheprovider", "test_x.py"],
        cwd=pytester.path, capture_output=True, text=True, env=env,
    )
    combined = proc.stdout + proc.stderr
    assert "model loaded in a fast test" in combined, combined
    assert proc.returncode != 0


def test_slow_test_can_load_model_marker_only(pytester):
    """Marked slow test with no assertion on inference: must be collected."""
    _marker_setup(pytester, "")
    (pytester.path / "test_x.py").write_text(
        'import pytest\n'
        '@pytest.mark.slow\n'
        'def test_x(): assert True\n'
    )
    result = pytester.runpytest_subprocess("--collect-only", "-q")
    assert "1 test collected" in result.stdout.str(), result.stdout.str()


def test_fast_lane_collects_more_than_zero_in_project():
    """The real project must expose a non-empty fast lane."""
    import subprocess
    import sys

    out = subprocess.run(
        [sys.executable, "-m", "pytest", "-m", "fast", "--collect-only", "-q",
         "tests/unit", "tests/integration", "tests/e2e", "tests/negative"],
        cwd=REPO, capture_output=True, text=True,
    )
    assert "no tests ran" not in out.stdout, out.stdout + out.stderr
    assert "::" in out.stdout, f"fast lane must collect tests, got: {out.stdout}"
