"""S5 offline ASR proof: real faster-whisper tiny.en transcription with network blocked."""
import socket

# Import first (av/torch need socket at import time)
from faster_whisper import WhisperModel

# Hard-block all network egress for the transcription phase
class _Blocked:
    def __init__(self, *a, **k):
        raise OSError("network disabled for offline ASR proof")

socket.socket = _Blocked
socket.create_connection = _Blocked
socket.getaddrinfo = _Blocked

model = WhisperModel("tiny.en", device="cpu", compute_type="int8",
                     download_root="models/whisper-tiny.en")
segments_iter, info = model.transcribe("fixtures/audio/smoke_test.wav")
text = " ".join(s.text for s in segments_iter).strip()
print("transcribed:", text)
assert text, "empty transcription"
print("OFFLINE_ASR_PROOF_OK")
