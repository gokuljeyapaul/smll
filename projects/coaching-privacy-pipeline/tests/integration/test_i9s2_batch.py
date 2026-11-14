"""I9-S2 RED: no device auto-selection; windows extracted serially (issue #9 slice 2).

Slice 2 per the revised plan: optional CUDA via device="auto" with CPU
fallback unchanged; amortise model load/batch inference where the profile
shows it matters; span sets identical on the CPU baseline.
"""
from __future__ import annotations

import pathlib

import pytest

pytestmark = pytest.mark.slow

REPO = pathlib.Path(__file__).resolve().parents[2]


def test_extractor_reports_device_and_cpu_fallback():
    from coaching_privacy.context_extractor import GLiNERContextExtractor

    ex = GLiNERContextExtractor()
    info = ex.model_info()
    assert "device" in info, info
    # CUDA_VISIBLE_DEVICES="" (this environment): device must be cpu
    assert info["device"] == "cpu", info


def test_extract_batch_identical_to_serial():
    """Amortised batch extraction across windows must produce span sets
    identical to the serial per-window extraction (CPU baseline)."""
    from coaching_privacy.context_extractor import GLiNERContextExtractor

    ex = GLiNERContextExtractor()
    texts = [
        "I am the only Director of Lunar Logistics at Auricwood Labs, a team of seven.",
        "We won the Lantern Award in April near Sylvar City.",
        "I want to lead better meetings.",
    ]
    serial = []
    for t in texts:
        serial.append(sorted(
            (s.start, s.end, s.label, s.value, s.confidence) for s in ex.extract(t)
        ))
    batched = ex.extract_batch(texts)
    assert len(batched) == len(texts)
    for got, expected in zip(batched, serial):
        got_sorted = sorted(
            (s.start, s.end, s.label, s.value, s.confidence) for s in got
        )
        assert got_sorted == expected
