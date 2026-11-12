"""S5 negative tests: no silent release of ambiguous ASR-derived transcripts."""
import sys
import pathlib

PROJECT = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(PROJECT / "src"))


def test_uncertain_asr_output_routed_to_review():
    """Transcripts derived from uncertain/ambiguous ASR must never be RELEASE_CANDIDATE."""
    from coaching_privacy.pipeline import SafetyGate

    gate = SafetyGate()
    decision = gate.decide(
        {
            "validator_available": True,
            "residual_pii": [],
            "context_risks": [],
            "asr_uncertain": True,
            "all_mandatory_stages_executed": True,
        },
        purpose="internal_coaching_analysis",
    )
    # uncertain ASR cannot silently release; at minimum REVIEW_REQUIRED
    assert decision["decision"] in {"REVIEW_REQUIRED", "BLOCKED", "FAILED"}


def test_wav_path_traversal_rejected(tmp_path):
    from coaching_privacy.asr import FasterWhisperAdapter, ASRError

    adapter = FasterWhisperAdapter(model_dir=str(PROJECT / "models" / "whisper-tiny.en"))
    try:
        adapter.transcribe("../../etc/passwd")
    except ASRError:
        pass  # rejected (either traversal guard or not-a-wav); never success
    else:
        raise AssertionError("traversal/garbage path accepted")


def test_oversized_audio_rejected(tmp_path):
    from coaching_privacy.asr import FasterWhisperAdapter, ASRError

    big = tmp_path / "big.wav"
    big.write_bytes(b"RIFF" + b"\x00" * (60 * 1024 * 1024))  # > 50MB junk
    adapter = FasterWhisperAdapter(model_dir=str(PROJECT / "models" / "whisper-tiny.en"))
    try:
        adapter.transcribe(str(big))
    except ASRError:
        pass
    else:
        raise AssertionError("oversized audio accepted")
