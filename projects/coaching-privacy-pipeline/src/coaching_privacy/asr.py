"""Real offline faster-whisper ASR adapter + fault injection (S5, A13).

Pinned `tiny.en` model loaded from a local directory with network egress
blocked; corrupt audio, traversal paths, oversized files and missing models
all fail closed via ASRError — never a false success. ASR uncertainty is
surfaced explicitly; the adapter performs no diarization.
"""
from __future__ import annotations

import os
import pathlib
import time
from typing import Any

MAX_AUDIO_BYTES = 50 * 1024 * 1024
DEFAULT_MODEL_DIR = "models/whisper-tiny.en"


class ASRError(RuntimeError):
    """ASR failure; callers must fail closed, never release silently."""


class _NetworkBlocked:
    def __init__(self, *a, **k):
        raise OSError("network disabled during ASR")


class BaseASRAdapter:
    def transcribe(self, wav_path: str) -> dict[str, Any]:
        raise NotImplementedError

    def model_info(self) -> dict[str, Any]:
        raise NotImplementedError


class FasterWhisperAdapter(BaseASRAdapter):
    def __init__(self, model_dir: str | None = None):
        self.model_dir = str(
            pathlib.Path(model_dir) if model_dir else pathlib.Path(DEFAULT_MODEL_DIR)
        )
        self._model = None

    def _validate_path(self, wav_path: str) -> pathlib.Path:
        p = pathlib.Path(wav_path)
        if ".." in p.parts:
            raise ASRError(f"path traversal rejected: {wav_path}")
        if not p.is_file():
            raise ASRError(f"audio file not found: {wav_path}")
        if p.stat().st_size > MAX_AUDIO_BYTES:
            raise ASRError("audio file exceeds 50MB limit")
        return p

    def _ensure_model(self) -> None:
        if self._model is not None:
            return
        import socket

        orig = socket.socket
        socket.socket = _NetworkBlocked
        os.environ["HF_HUB_OFFLINE"] = "1"
        try:
            from faster_whisper import WhisperModel

            self._model = WhisperModel(
                "tiny.en", device="cpu", compute_type="int8",
                download_root=self.model_dir,
            )
        except Exception as exc:
            raise ASRError(f"speech model unavailable: {exc}") from exc
        finally:
            socket.socket = orig

    def transcribe(self, wav_path: str) -> dict[str, Any]:
        p = self._validate_path(wav_path)
        self._ensure_model()
        t0 = time.monotonic()
        try:
            segments_iter, info = self._model.transcribe(str(p))
            text = " ".join(s.text for s in segments_iter).strip()
        except ASRError:
            raise
        except Exception as exc:
            raise ASRError(f"transcription failed (corrupt/unsupported audio?): {exc}") from exc
        runtime_s = round(time.monotonic() - t0, 3)
        if not text:
            raise ASRError("no speech content detected")
        avg_logprob = getattr(info, "avg_logprob", None)
        uncertain = bool(avg_logprob is not None and avg_logprob < -1.0)
        return {
            "text": text,
            "model": "tiny.en",
            "engine": "faster-whisper",
            "language": getattr(info, "language", "en"),
            "runtime_s": runtime_s,
            "avg_logprob": avg_logprob,
            "uncertain": uncertain,
            "speaker_attribution": "manual",  # ASR does not diarize
        }

    def model_info(self) -> dict[str, Any]:
        return {
            "model": "tiny.en",
            "engine": "faster-whisper",
            "local_only": True,
            "model_dir": self.model_dir,
        }


class FaultyASRAdapter(BaseASRAdapter):
    """Deterministic fault injection for failure tests only (never a real model)."""

    def __init__(self, error_type: str = "corrupt_audio"):
        self.error_type = error_type

    def transcribe(self, wav_path: str) -> dict[str, Any]:
        raise ASRError(f"fault injection: corrupt audio cannot be transcribed ({wav_path})")

    def model_info(self) -> dict[str, Any]:
        return {"model": "fault-injection", "engine": "none", "local_only": True}
