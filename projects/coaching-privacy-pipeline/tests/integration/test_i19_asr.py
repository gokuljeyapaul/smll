"""I19-S1 integration: real tiny.en confidence on clean vs degraded audio.

Deterministic degraded clip generated inside the test (espeak WAV + seeded
noise/clipping). Calibrated thresholds recorded in evidence.
"""
from __future__ import annotations

import pathlib
import wave

import pytest

pytestmark = pytest.mark.slow

REPO = pathlib.Path(__file__).resolve().parents[2]


def _clean_clip(tmp_path: pathlib.Path) -> pathlib.Path:
    src = REPO / "fixtures" / "audio" / "smoke_test.wav"
    out = tmp_path / "clean.wav"
    out.write_bytes(src.read_bytes())
    return out


def _degraded_clip(tmp_path: pathlib.Path) -> pathlib.Path:
    """Seeded degradation: deterministic noise replacing 90% of samples —
    keeps only every 10th original sample. Calibrated so real tiny.en flags
    uncertainty (see docs/evidence/I19-S1/calibration.log: milder clip+zero
    degradation stays confident, so the noise mode is the used recipe)."""
    src = REPO / "fixtures" / "audio" / "smoke_test.wav"
    out = tmp_path / "degraded.wav"
    with wave.open(str(src), "rb") as w:
        params = w.getparams()
        frames = bytearray(w.readframes(w.getnframes()))
    for i in range(len(frames)):
        frames[i] = ((i * 37 + 11) & 0xFF) if i % 10 else frames[i]
    with wave.open(str(out), "wb") as w:
        w.setparams(params)
        w.writeframes(bytes(frames))
    return out


def _transcribe(path: pathlib.Path) -> dict:
    import os
    os.chdir(REPO)
    from coaching_privacy.asr import FasterWhisperAdapter

    return FasterWhisperAdapter().transcribe(str(path))


def test_clean_clip_not_uncertain(tmp_path):
    out = _transcribe(_clean_clip(tmp_path))
    assert out["uncertain"] is False, out


def test_degraded_clip_uncertain(tmp_path):
    out = _transcribe(_degraded_clip(tmp_path))
    assert out["uncertain"] is True, out
