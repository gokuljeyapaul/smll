"""Shared fixtures. Deliberately imports nothing from folderchat at module level:
at RED time every test must fail per-test on the missing behaviour, not die at collection."""
from __future__ import annotations

import json
import os
import pathlib
import socket
import subprocess
import sys

import pytest

PROJECT_ROOT = pathlib.Path(__file__).resolve().parents[1]
FIXTURES = PROJECT_ROOT / "fixtures"
CORPUS = FIXTURES / "corpus"
QA = FIXTURES / "qa.jsonl"
MODELS_DIR = pathlib.Path(os.environ.get("FOLDERCHAT_MODEL_DIR", PROJECT_ROOT / ".cache" / "models"))
MANIFEST = pathlib.Path(os.environ.get("FOLDERCHAT_MANIFEST", PROJECT_ROOT / "scripts" / "model_manifest.json"))


def run_bench_enabled() -> bool:
    return os.environ.get("FOLDERCHAT_RUN_BENCH", "") == "1"


def pytest_collection_modifyitems(config, items):  # noqa: ANN001
    skip_bench = pytest.mark.skip(reason="bench runs on the building host only (FOLDERCHAT_RUN_BENCH=1)")
    for item in items:
        path = str(item.fspath).replace("\\", "/")
        # explicit markers win; otherwise assign by directory
        if not any(m in item.keywords for m in ("fast", "slow", "bench")):
            if "/tests/bench/" in path:
                item.add_marker(pytest.mark.bench)
            elif "/tests/unit/" in path or "/tests/negative/" in path:
                item.add_marker(pytest.mark.fast)
            else:
                item.add_marker(pytest.mark.slow)
        if "bench" in item.keywords and not run_bench_enabled():
            item.add_marker(skip_bench)


@pytest.fixture
def data_dir(tmp_path, monkeypatch):
    """Isolated app data dir for both in-process and CLI-subprocess runs."""
    d = tmp_path / "folderchat-data"
    monkeypatch.setenv("FOLDERCHAT_DATA_DIR", str(d))
    yield d


@pytest.fixture
def cli(data_dir):
    """Run the folderchat CLI as a subprocess (behavioural e2e), returning the CompletedProcess."""
    def _cli(args: list[str], timeout: int = 600) -> subprocess.CompletedProcess:
        env = dict(os.environ)
        env["FOLDERCHAT_DATA_DIR"] = str(data_dir)
        return subprocess.run(
            [sys.executable, "-m", "folderchat", *args],
            cwd=str(PROJECT_ROOT), env=env, capture_output=True, text=True, timeout=timeout,
        )
    return _cli


@pytest.fixture
def offline(monkeypatch):
    """Refuse any socket creation: whatever runs under this fixture must work with no network."""
    class NoNetwork(socket.socket):
        def __init__(self, *a, **kw):  # noqa: ANN002, ANN003
            raise AssertionError("network access attempted while offline guard is active")

    monkeypatch.setattr(socket, "socket", NoNetwork)
    monkeypatch.setattr(socket, "create_connection", lambda *a, **kw: (_ for _ in ()).throw(AssertionError("network")))
    yield


@pytest.fixture
def corpus_path():
    assert CORPUS.is_dir(), f"fixture corpus missing at {CORPUS}"
    return CORPUS


@pytest.fixture
def qa_lines():
    assert QA.is_file(), f"fixtures/qa.jsonl missing at {QA}"
    return [json.loads(line) for line in QA.read_text(encoding="utf-8").splitlines() if line.strip()]


@pytest.fixture
def answer_model_path():
    """Path of the pinned answer-role model file, skipping the test when not fetched."""
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8")) if MANIFEST.suffix == ".json" else None
    if manifest is None:  # pragma: no cover - manifest always exists in-tree
        manifest = json.loads((PROJECT_ROOT / "scripts" / "model_manifest.json").read_text(encoding="utf-8"))
    entry = manifest["roles"]["answer"]
    if entry.get("url") is None:
        pytest.skip("answer role is the BM25 baseline (passages mode); no answer model to load")
    p = MODELS_DIR / entry["file"]
    if not p.is_file():
        pytest.skip(f"answer model not fetched: {p}")
    return p


@pytest.fixture
def load_engine():
    """Factory: AnswerEngine over the real pinned model with overridable runtime knobs."""
    def _load(**overrides):
        import json as _json

        from folderchat.answer import AnswerEngine

        manifest = _json.loads(MANIFEST.read_text(encoding="utf-8"))
        return AnswerEngine(manifest, model_path=MODELS_DIR / manifest["roles"]["answer"]["file"], **overrides)
    return _load


def pytest_configure(config):  # noqa: ANN001
    config.addinivalue_line("markers", "fast: no model inference")
    config.addinivalue_line("markers", "slow: real model inference")
    config.addinivalue_line("markers", "bench: full evals on the building host only")
