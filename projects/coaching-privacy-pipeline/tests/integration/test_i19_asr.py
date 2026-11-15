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
    """Seeded degradation: deterministic noise replacing most samples —
    keeps only every 7th original sample. Calibrated so real tiny.en flags
    uncertainty (see docs/evidence/I19-S1/calibration.log and the I13-S2
    recalibration note: the earlier keep-every-10th recipe sits on the edge
    — on slower CI CPUs tiny.en sometimes yields 0 segments, hitting the
    fail-closed ASRError path instead of uncertain=True; keeping every 7th
    sample produces a robustly-flagged uncertain transcript on the
    reference CPU with max_no_speech_prob 0.945 — far above the 0.5
    ceiling — so the flag does not depend on borderline segment survival;
    base.en flags the same clip via min_avg_logprob -0.927 < -0.85)."""
    src = REPO / "fixtures" / "audio" / "smoke_test.wav"
    out = tmp_path / "degraded.wav"
    with wave.open(str(src), "rb") as w:
        params = w.getparams()
        frames = bytearray(w.readframes(w.getnframes()))
    for i in range(len(frames)):
        frames[i] = ((i * 37 + 11) & 0xFF) if i % 7 else frames[i]
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


def test_degraded_clip_fails_closed(tmp_path):
    """Degraded clip: either the model transcribes and flags uncertainty, or
    it finds no speech and the adapter fails closed (ASRError). Both paths
    prevent a confident release; neither may return uncertain=False.
    (CI runners may detect no speech at all in the noise recipe — that is
    also correct fail-closed behavior.)"""
    from coaching_privacy.asr import ASRError

    try:
        out = _transcribe(_degraded_clip(tmp_path))
    except ASRError as exc:
        # Fail-closed path: no transcript is produced, so nothing can be
        # released. This is an assertion, not a skip: the test must never be
        # silently skipped. The uncertain->gate wiring itself is proven
        # model-free in tests/e2e/test_i19_e2e.py (hand-built uncertain
        # transcripts -> REVIEW_REQUIRED).
        assert "no speech" in str(exc).lower() or "transcription failed" in str(exc).lower(), exc
        return
    assert out["uncertain"] is True, out
