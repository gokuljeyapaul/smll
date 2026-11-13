"""I19-S1 RED: ASR uncertainty is never computed (issue #19 slice 1).

The adapter reads `info.avg_logprob`, which does not exist on
faster-whisper's TranscriptionInfo (Step 0 evidence), so `uncertain` is
always False. These tests use a fake model object returning realistic
segments and require real per-segment confidence aggregation.
"""
from __future__ import annotations

from typing import Any

import pytest

pytestmark = pytest.mark.fast


class _FakeInfo:
    def __init__(self, language="en", language_probability=0.98):
        self.language = language
        self.language_probability = language_probability


class _FakeSegment:
    def __init__(self, text, avg_logprob, no_speech_prob, compression_ratio):
        self.text = text
        self.avg_logprob = avg_logprob
        self.no_speech_prob = no_speech_prob
        self.compression_ratio = compression_ratio


class _FakeModel:
    def __init__(self, segments, info):
        self._segments = segments
        self._info = info

    def transcribe(self, path, **k):
        return iter(self._segments), self._info


def _adapter_with(model) -> Any:
    from coaching_privacy.asr import FasterWhisperAdapter

    a = FasterWhisperAdapter()
    a._model = model  # bypass real load
    return a


def _wav(tmp_path):
    p = tmp_path / "clip.wav"
    p.write_bytes(b"RIFF" + b"\x00" * 100)  # fake wav; fake model ignores it
    return str(p)


def test_low_avg_logprob_flags_uncertain(tmp_path):
    segs = [_FakeSegment("hello there", avg_logprob=-1.4, no_speech_prob=0.05,
                         compression_ratio=1.2)]
    a = _adapter_with(_FakeModel(segs, _FakeInfo()))
    out = a.transcribe(_wav(tmp_path))
    assert out["uncertain"] is True, out


def test_high_no_speech_prob_flags_uncertain(tmp_path):
    segs = [_FakeSegment("uh", avg_logprob=-0.2, no_speech_prob=0.7,
                         compression_ratio=1.1)]
    a = _adapter_with(_FakeModel(segs, _FakeInfo()))
    out = a.transcribe(_wav(tmp_path))
    assert out["uncertain"] is True, out


def test_clean_segments_not_uncertain(tmp_path):
    segs = [
        _FakeSegment("My name is Mira.", avg_logprob=-0.15, no_speech_prob=0.02,
                     compression_ratio=1.3),
        _FakeSegment("I want better meetings.", avg_logprob=-0.2,
                     no_speech_prob=0.03, compression_ratio=1.4),
    ]
    a = _adapter_with(_FakeModel(segs, _FakeInfo()))
    out = a.transcribe(_wav(tmp_path))
    assert out["uncertain"] is False, out


def test_signals_aggregated(tmp_path):
    segs = [
        _FakeSegment("a", avg_logprob=-0.1, no_speech_prob=0.2,
                     compression_ratio=1.5),
        _FakeSegment("b", avg_logprob=-0.9, no_speech_prob=0.6,
                     compression_ratio=2.5),
    ]
    a = _adapter_with(_FakeModel(segs, _FakeInfo(language_probability=0.9)))
    out = a.transcribe(_wav(tmp_path))
    sig = out["signals"]
    assert sig["min_avg_logprob"] == pytest.approx(-0.9), sig
    assert sig["max_no_speech_prob"] == pytest.approx(0.6), sig
    assert sig["max_compression_ratio"] == pytest.approx(2.5), sig
    assert sig["language_probability"] == pytest.approx(0.9), sig


def test_low_language_probability_flags_uncertain(tmp_path):
    segs = [_FakeSegment("text", avg_logprob=-0.1, no_speech_prob=0.05,
                         compression_ratio=1.2)]
    a = _adapter_with(_FakeModel(segs, _FakeInfo(language_probability=0.41)))
    out = a.transcribe(_wav(tmp_path))
    assert out["uncertain"] is True, out
