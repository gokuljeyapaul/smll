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

# Issue #18 slice 2: runtime fail-closed model verification against the
# pinned manifest; the whisper snapshot dir layout is resolved like
# faster-whisper does (models--Systran--faster-whisper-tiny.en/snapshots/<rev>).
_DEFAULT_MANIFEST = pathlib.Path(__file__).resolve().parents[2] / "scripts" / "model_manifest.json"
_VERIFIED: set[str] = set()


def _verify_model_entry(model_key: str, resolved_dir: pathlib.Path) -> None:
    """Raise RuntimeError naming the offending file if any manifest-listed
    file is missing or its sha256 does not match. Cached per process on
    success only."""
    import hashlib
    import json
    import os

    manifest_path = pathlib.Path(
        os.environ.get("COACHING_MODEL_MANIFEST", str(_DEFAULT_MANIFEST))
    )
    cache_key = f"{model_key}:{resolved_dir}:{manifest_path}"
    if cache_key in _VERIFIED:
        return
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise RuntimeError(f"model manifest missing: {manifest_path}") from exc
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"model manifest malformed: {manifest_path} ({exc})") from exc
    entry = manifest.get("models", {}).get(model_key)
    if not isinstance(entry, dict) or not entry.get("files"):
        raise RuntimeError(f"model manifest has no file entries for '{model_key}'")
    for rel_file, expected in entry["files"].items():
        target = resolved_dir / rel_file
        if not target.is_file():
            raise RuntimeError(f"model file missing: {model_key}/{rel_file}")
        digest = hashlib.sha256()
        with target.open("rb") as fh:
            for chunk in iter(lambda: fh.read(1024 * 1024), b""):
                digest.update(chunk)
        actual = digest.hexdigest()
        expected_hash = str(expected).lower().removeprefix("sha256:")
        if actual != expected_hash:
            raise RuntimeError(
                f"model file hash mismatch: {model_key}/{rel_file} "
                f"(expected sha256:{expected_hash}, got sha256:{actual})"
            )
    _VERIFIED.add(cache_key)


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

    def _verify_model_files(self) -> None:
        """Issue #18 slice 2: fail closed if the whisper snapshot files do
        not match the pinned manifest before loading (once per process)."""
        root = pathlib.Path(self.model_dir)
        snaps = sorted(root.glob("models--Systran--faster-whisper-tiny.en/snapshots/*"))
        if not snaps:
            raise RuntimeError(
                f"whisper tiny.en snapshot not found under {root} "
                "(run scripts/setup.sh first)"
            )
        _verify_model_entry("whisper_tiny_en", snaps[0])

    def _ensure_model(self) -> None:
        if self._model is not None:
            return
        try:
            self._verify_model_files()
        except RuntimeError as exc:
            raise ASRError(f"speech model verification failed: {exc}") from exc
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
