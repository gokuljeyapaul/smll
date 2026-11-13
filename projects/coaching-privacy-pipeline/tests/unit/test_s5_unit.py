"""S5 unit tests: audio input schema, ASR adapter contract, WER/CER metrics."""
import sys
import pytest
import pathlib

pytestmark = pytest.mark.fast

PROJECT = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(PROJECT / "src"))


def test_audio_transcript_schema_valid():
    from coaching_privacy.audio import AudioTranscriptInput

    data = {
        "schema_version": "1.0",
        "session_id": "audio-s1",
        "source_type": "synthetic_audio",
        "purpose": "internal_coaching_analysis",
        "language": "en",
        "speakers": [
            {"id": "S1", "role": "COACH"},
            {"id": "S2", "role": "CLIENT"},
        ],
        "utterances": [
            {"id": "u1", "speaker_id": "S2", "start_ms": 0, "end_ms": 2500,
             "text": "My name is Mira Solen, and I want to lead better meetings."},
        ],
        "metadata": {
            "synthetic": True,
            "audio_file": "session.wav",
            "asr": {"model": "tiny.en", "engine": "faster-whisper",
                    "speaker_attribution": "manual"},
        },
    }
    at = AudioTranscriptInput.parse(data)
    assert at.session_id == "audio-s1"
    assert at.metadata["asr"]["model"] == "tiny.en"


def test_audio_schema_requires_speaker_attribution_metadata():
    """ASR cannot diarize; speaker attribution must be explicit."""
    from coaching_privacy.audio import AudioTranscriptInput, ContractError

    data = {
        "schema_version": "1.0",
        "session_id": "audio-s2",
        "source_type": "synthetic_audio",
        "purpose": "internal_coaching_analysis",
        "language": "en",
        "speakers": [{"id": "S1", "role": "COACH"}],
        "utterances": [
            {"id": "u1", "speaker_id": "S1", "start_ms": 0, "end_ms": 1000,
             "text": "hello"},
        ],
        "metadata": {"synthetic": True, "audio_file": "x.wav"},  # no asr block
    }
    try:
        AudioTranscriptInput.parse(data)
    except ContractError as exc:
        assert "speaker" in str(exc).lower() or "asr" in str(exc).lower()
    else:
        raise AssertionError("missing speaker-attribution metadata accepted")


def test_wer_and_cer_computed_correctly():
    from coaching_privacy.audio_metrics import wer, cer

    ref = "my name is mira solen"
    hyp = "my name is mira solem"
    # 1 substitution of 5 words -> WER 0.2
    assert abs(wer(ref, hyp) - 0.2) < 1e-9
    # 1 char insertion on 17 chars -> CER 1/17
    assert abs(cer(ref, hyp) - 1 / 17) < 1e-6
    assert wer(ref, ref) == 0.0


def test_fault_asr_adapter_raises():
    """Fault injection: a broken ASR adapter must raise, never return empty success."""
    from coaching_privacy.asr import FaultyASRAdapter

    adapter = FaultyASRAdapter(error_type="corrupt_audio")
    try:
        adapter.transcribe("nonexistent.wav")
    except Exception as exc:
        assert "corrupt" in str(exc).lower() or "audio" in str(exc).lower()
    else:
        raise AssertionError("faulty ASR silently succeeded")
