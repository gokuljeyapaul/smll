"""S5 integration tests: real faster-whisper CPU transcription contract (A13)."""
import subprocess
import pytest
import sys
import pathlib

pytestmark = pytest.mark.slow

PROJECT = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(PROJECT / "src"))

MODEL_DIR = PROJECT / "models" / "whisper-tiny.en"


def _make_wav(tmp_path, text):
    wav = tmp_path / "tts.wav"
    subprocess.run(
        ["espeak-ng", "-v", "en-us", "-s", "140", text, "-w", str(wav)],
        check=True, capture_output=True,
    )
    return wav


def test_real_asr_transcribes_synthetic_speech(tmp_path):
    from coaching_privacy.asr import FasterWhisperAdapter

    wav = _make_wav(tmp_path, "I want to set boundaries with my colleagues")
    adapter = FasterWhisperAdapter(model_dir=str(MODEL_DIR))
    result = adapter.transcribe(str(wav))
    assert result["text"].strip(), "empty transcription"
    assert "boundaries" in result["text"].lower()
    assert result["model"] == "tiny.en"
    assert result["engine"] == "faster-whisper"
    assert result["runtime_s"] > 0
    assert result["uncertain"] is False


def test_real_asr_reports_model_and_is_offline(tmp_path):
    from coaching_privacy.asr import FasterWhisperAdapter

    wav = _make_wav(tmp_path, "hello there")
    adapter = FasterWhisperAdapter(model_dir=str(MODEL_DIR))
    info = adapter.model_info()
    assert info["model"] == "tiny.en"
    assert info["local_only"] is True
    result = adapter.transcribe(str(wav))
    assert result["text"]


def test_corrupt_audio_fails_closed(tmp_path):
    """A corrupt/truncated WAV must raise, never produce a false success."""
    from coaching_privacy.asr import FasterWhisperAdapter, ASRError

    bad = tmp_path / "corrupt.wav"
    bad.write_bytes(b"RIFF" + b"\x00" * 100)  # truncated header junk
    adapter = FasterWhisperAdapter(model_dir=str(MODEL_DIR))
    try:
        adapter.transcribe(str(bad))
    except ASRError:
        pass
    else:
        raise AssertionError("corrupt audio accepted")
