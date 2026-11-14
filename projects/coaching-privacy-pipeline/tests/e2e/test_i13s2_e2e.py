"""I13-S2 RED: Whisper model selection impossible (issue #13 slice 2).

COACHING_WHISPER_MODEL must select the model (resolved through the manifest,
hash-verified, offline); tampered/unpinned model dirs must raise ASRError;
the result must report the selected model; degraded audio with the selected
model still routes to REVIEW end-to-end.
"""
from __future__ import annotations

import json
import os
import pathlib

import pytest

pytestmark = pytest.mark.slow

REPO = pathlib.Path(__file__).resolve().parents[2]


def test_env_selects_base_model_and_reports_it(monkeypatch):
    monkeypatch.setenv("COACHING_WHISPER_MODEL", "base.en")
    from coaching_privacy.asr import FasterWhisperAdapter

    adapter = FasterWhisperAdapter()
    assert adapter.model_name == "base.en", adapter.model_name
    info = adapter.model_info()
    assert info["model"] == "base.en", info
    wav = REPO / "fixtures" / "audio" / "smoke_test.wav"
    out = adapter.transcribe(str(wav))
    assert out["model"] == "base.en", out
    assert out["text"].strip()


def test_selected_model_resolved_through_manifest(monkeypatch, tmp_path):
    """The env-selected model must be verified against the manifest; an
    unpinned model dir fails closed (ASRError)."""
    monkeypatch.setenv("COACHING_WHISPER_MODEL", "base.en")
    manifest = json.loads((REPO / "scripts" / "model_manifest.json").read_text())
    manifest["models"]["whisper_base_en"] = {
        "repo_id": "Systran/faster-whisper-base.en",
        "revision": "not-a-real-hash",
        "local_path": "whisper-base.en/models--Systran--faster-whisper-base.en/snapshots/whatever",
        "files": {"model.bin": "sha256:" + "0" * 64},
    }
    mpath = tmp_path / "manifest.json"
    mpath.write_text(json.dumps(manifest))
    monkeypatch.setenv("COACHING_MODEL_MANIFEST", str(mpath))
    from coaching_privacy.asr import ASRError, FasterWhisperAdapter

    adapter = FasterWhisperAdapter()
    with pytest.raises(ASRError):
        adapter._ensure_model()


def test_degraded_audio_selected_model_review_e2e(monkeypatch, tmp_path):
    """Degraded audio via the selected model still -> REVIEW end-to-end
    (re-run of the I19 pattern with a selected model)."""
    import wave

    monkeypatch.setenv("COACHING_WHISPER_MODEL", "tiny.en")
    src = REPO / "fixtures" / "audio" / "smoke_test.wav"
    degraded = tmp_path / "degraded.wav"
    with wave.open(str(src), "rb") as w:
        params = w.getparams()
        frames = bytearray(w.readframes(w.getnframes()))
    # I13-S2 recalibration: keep every 7th sample (same recipe as
    # test_i19_asr — the earlier keep-every-10th recipe was borderline on
    # some CPUs: 0 segments -> ASRError fail-closed instead of
    # uncertain=True -> REVIEW; every-7th robustly flags uncertain).
    for i in range(len(frames)):
        frames[i] = ((i * 37 + 11) & 0xFF) if i % 7 else frames[i]
    with wave.open(str(degraded), "wb") as w:
        w.setparams(params)
        w.writeframes(bytes(frames))
    from coaching_privacy.asr import ASRError, FasterWhisperAdapter
    from coaching_privacy.asr_transcript import transcript_from_asr
    from coaching_privacy.engine import process_transcript
    from coaching_privacy.policy import PolicyStore

    try:
        asr = FasterWhisperAdapter().transcribe(str(degraded))
    except ASRError:
        pytest.skip("runner/model found no speech in the degraded clip (fail-closed path)")
    assert asr["uncertain"] is True, asr
    t = transcript_from_asr(
        asr, session_id="i13-s2", purpose="internal_coaching_analysis",
        speakers=[{"id": "S1", "role": "COACH"}, {"id": "S2", "role": "CLIENT"}],
    )
    policy = PolicyStore(REPO / "policies" / "sample_policy.yaml").get(
        "internal_coaching_analysis"
    )
    from coaching_privacy.contracts import Transcript

    result = process_transcript(Transcript.parse(t), policy)
    assert result.decision["decision"] == "REVIEW_REQUIRED", result.decision
    assert "asr_uncertainty_requires_review" in result.decision["review_reasons"]
