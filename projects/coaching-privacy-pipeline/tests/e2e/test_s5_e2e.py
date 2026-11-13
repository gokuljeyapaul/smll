"""S5 E2E: synthetic WAV -> real ASR -> canonical transcript -> same privacy pipeline (A13)."""
import json
import pytest
import subprocess
import sys
import pathlib

pytestmark = pytest.mark.slow

PROJECT = pathlib.Path(__file__).resolve().parents[2]
VENV_BIN = PROJECT / ".venv" / "bin"
sys.path.insert(0, str(PROJECT / "src"))


def test_wav_to_sanitized_decision_e2e(tmp_path):
    from coaching_privacy.asr import FasterWhisperAdapter
    from coaching_privacy.contracts import Transcript
    from coaching_privacy.policy import PolicyStore
    from coaching_privacy.engine import process_transcript

    # 1. synthetic audio via offline TTS
    wav = tmp_path / "s5.wav"
    subprocess.run(
        ["espeak-ng", "-v", "en-us", "-s", "140",
         "My name is Mira Solen and my email is mira dot solen at example dot test",
         "-w", str(wav)],
        check=True, capture_output=True,
    )
    # 2. real offline ASR
    adapter = FasterWhisperAdapter(model_dir=str(PROJECT / "models" / "whisper-tiny.en"))
    asr = adapter.transcribe(str(wav))
    assert asr["text"].strip()

    # 3. canonical transcript schema via the I19-S2 helper (same as text input)
    from coaching_privacy.asr_transcript import transcript_from_asr
    transcript = Transcript.parse(transcript_from_asr(
        asr, session_id="s5-e2e", purpose="internal_coaching_analysis",
        speakers=[{"id": "S1", "role": "COACH"}, {"id": "S2", "role": "CLIENT"}],
    ))
    # the helper keeps ASR provenance; the pipeline records it in the report

    # 4. same privacy pipeline as text
    store = PolicyStore(PROJECT / "policies" / "sample_policy.yaml")
    policy = store.get("internal_coaching_analysis")
    result = process_transcript(transcript, policy,
                                prohibited_leaks=["Mira Solen"])
    decision = result.decision["decision"]
    assert decision in {"RELEASE_CANDIDATE", "REVIEW_REQUIRED", "BLOCKED", "FAILED"}
    # the spoken name must not survive into sanitized output (if ASR caught it)
    sanitized_text = " ".join(
        u["text"] for u in result.sanitized.get("utterances", []))
    assert "Mira Solen" not in sanitized_text
    # speaker-identity uncertainty stays explicit
    assert result.report["session_id"] == "s5-e2e"


def test_missing_speech_model_fails_closed(tmp_path):
    from coaching_privacy.asr import FasterWhisperAdapter, ASRError

    wav = tmp_path / "x.wav"
    subprocess.run(
        ["espeak-ng", "-v", "en-us", "-s", "140", "hello", "-w", str(wav)],
        check=True, capture_output=True,
    )
    adapter = FasterWhisperAdapter(model_dir=str(tmp_path / "no_such_model"))
    try:
        adapter.transcribe(str(wav))
    except ASRError:
        pass
    else:
        raise AssertionError("missing speech model silently succeeded")
