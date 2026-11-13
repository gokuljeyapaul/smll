"""I16: fast/slow marker discipline + fast-lane model-load guard.

- Every collected test must carry exactly one of `fast`/`slow`; otherwise the
  run fails at collection time (a slow test cannot hide in the fast lane by
  being unmarked).
- `fast` tests get an autouse guard: any attempt to load GLiNER or Whisper
  (the real model entry points) raises AssertionError("model loaded in a fast
  test"). Presidio/spaCy is allowed in the fast lane (small, cached).
"""
from __future__ import annotations

import pathlib
import sys

import pytest

PROJECT_DIR = pathlib.Path(__file__).resolve().parents[1]

_GUARD_MSG = "model loaded in a fast test"


def pytest_collection_modifyitems(config, items):
    if config.option.collectonly:
        # Do not fail --collect-only runs for missing markers, but still tag
        # nothing: selection by -m relies on the marks themselves.
        return
    bad = []
    for item in items:
        has_fast = item.get_closest_marker("fast") is not None
        has_slow = item.get_closest_marker("slow") is not None
        if has_fast and has_slow:
            bad.append(f"{item.nodeid}: marked BOTH fast and slow (choose one)")
        elif not (has_fast or has_slow):
            bad.append(f"{item.nodeid}: missing marker (add exactly one of @pytest.mark.fast / @pytest.mark.slow)")
    if bad:
        for line in bad:
            print(f"MARKER DISCIPLINE ERROR: {line}")
        raise pytest.UsageError(
            "every test must have exactly one of the fast/slow markers; "
            f"{len(bad)} violation(s) (see MARKER DISCIPLINE ERROR lines above)"
        )


@pytest.fixture(autouse=True)
def _fast_no_model_load(request, monkeypatch):
    """In fast tests, block real GLiNER/Whisper model loads (I16)."""
    if request.node.get_closest_marker("fast") is not None:
        _install_fast_guards(monkeypatch)
    yield


def _install_fast_guards(monkeypatch):
    _GUARD_MSG = "model loaded in a fast test"

    def _blocked(*a, **k):
        raise AssertionError(_GUARD_MSG)

    import coaching_privacy.context_extractor as ce
    import coaching_privacy.asr as asr_mod

    monkeypatch.setattr(ce.GLiNERContextExtractor, "_ensure_loaded", _blocked)
    monkeypatch.setattr(
        ce.GLiNERContextExtractor, "from_pretrained", _blocked, raising=False
    )
    monkeypatch.setattr(asr_mod.FasterWhisperAdapter, "_ensure_model", _blocked)

    # Also block the engine's extractor cache from producing a real model.
    import coaching_privacy.engine as engine_mod

    class _NoModel:
        def extract(self, text, labels=None):
            raise AssertionError(_GUARD_MSG)

        def model_info(self):
            raise AssertionError(_GUARD_MSG)

    monkeypatch.setattr(engine_mod, "_get_context_extractor", lambda: _NoModel())
