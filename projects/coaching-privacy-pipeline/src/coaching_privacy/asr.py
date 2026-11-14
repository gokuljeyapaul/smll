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


DEFAULT_WHISPER_MODEL = "tiny.en"


class FasterWhisperAdapter(BaseASRAdapter):
    def __init__(self, model_dir: str | None = None):
        # I13-S2: model selectable via COACHING_WHISPER_MODEL (default
        # tiny.en), resolved through the manifest and hash-verified.
        self.model_name = os.environ.get(
            "COACHING_WHISPER_MODEL", DEFAULT_WHISPER_MODEL
        )
        if model_dir:
            self.model_dir = str(pathlib.Path(model_dir))
        else:
            self.model_dir = str(
                pathlib.Path(f"models/whisper-{self.model_name}")
            )
        self._model = None

    @property
    def _manifest_key(self) -> str:
        return "whisper_" + self.model_name.replace("-", "_").replace(".", "_")

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
        """Issue #18 slice 2 + I13-S2: fail closed if the selected model's
        snapshot files do not match the pinned manifest before loading."""
        root = pathlib.Path(self.model_dir)
        repo_dir = f"models--Systran--faster-whisper-{self.model_name}"
        snaps = sorted(root.glob(f"{repo_dir}/snapshots/*"))
        if not snaps:
            raise RuntimeError(
                f"whisper {self.model_name} snapshot not found under {root} "
                "(run scripts/setup.sh first)"
            )
        _verify_model_entry(self._manifest_key, snaps[0])

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
                self.model_name, device="cpu", compute_type="int8",
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
            segs = list(segments_iter)
            text = " ".join(s.text for s in segs).strip()
        except ASRError:
            raise
        except Exception as exc:
            raise ASRError(f"transcription failed (corrupt/unsupported audio?): {exc}") from exc
        runtime_s = round(time.monotonic() - t0, 3)
        if not text:
            raise ASRError("no speech content detected")
        # I19-S1: real confidence signals. Per-segment values are aggregated
        # (min avg_logprob, max no_speech_prob, max compression_ratio) plus
        # the info-level language probability. Thresholds come from the
        # policy YAML (asr_confidence); conservative defaults if absent.
        signals = _aggregate_signals(segs, info)
        # I13-S2: thresholds resolve per selected model (policy per_model).
        uncertain = _is_uncertain(
            signals, _load_thresholds(self.model_name)
        )
        return {
            "text": text,
            "model": self.model_name,
            "engine": "faster-whisper",
            "language": getattr(info, "language", "en"),
            "runtime_s": runtime_s,
            "avg_logprob": signals["min_avg_logprob"],
            "uncertain": uncertain,
            "signals": signals,
            "speaker_attribution": "manual",  # ASR does not diarize
        }

    def model_info(self) -> dict[str, Any]:
        return {
            "model": self.model_name,
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


# --- I19-S1: confidence signal aggregation ---

_THRESHOLD_DEFAULTS = {
    "min_avg_logprob_floor": -0.9,
    "no_speech_prob_ceiling": 0.5,
    "compression_ratio_ceiling": 2.4,
    "language_probability_floor": 0.5,
}


def _load_thresholds(model_name: str | None = None) -> dict[str, float]:
    """Load asr_confidence thresholds from the policy YAML (fail-safe
    defaults if missing — the defaults mirror the YAML).

    I13-S2: per-model overrides. The policy's asr_confidence.per_model may
    override the shared thresholds for the selected whisper model; missing
    keys fall back to the shared values (fail-safe, never looser than the
    shared calibrated defaults unless the policy explicitly says so)."""
    try:
        import pathlib as _pl

        policy = _pl.Path(__file__).resolve().parents[2] / "policies" / "sample_policy.yaml"
        import yaml  # type: ignore

        raw = yaml.safe_load(policy.read_text()) or {}
        section = raw.get("asr_confidence") or {}
        th = {
            k: float(section.get(k, v)) for k, v in _THRESHOLD_DEFAULTS.items()
        }
        if model_name:
            per_model = section.get("per_model") or {}
            override = per_model.get(model_name) or {}
            for k in _THRESHOLD_DEFAULTS:
                if k in override:
                    th[k] = float(override[k])
        return th
    except Exception:
        return dict(_THRESHOLD_DEFAULTS)


def _aggregate_signals(segments: list[Any], info: Any) -> dict[str, Any]:
    """Aggregate per-segment confidence signals (I19-S1)."""
    logprobs = [float(getattr(s, "avg_logprob", 0.0)) for s in segments]
    no_speech = [float(getattr(s, "no_speech_prob", 0.0)) for s in segments]
    comp = [float(getattr(s, "compression_ratio", 1.0)) for s in segments]
    return {
        "min_avg_logprob": min(logprobs) if logprobs else None,
        "max_no_speech_prob": max(no_speech) if no_speech else None,
        "max_compression_ratio": max(comp) if comp else None,
        "language_probability": float(
            getattr(info, "language_probability", 1.0) or 0.0
        ),
    }


def _is_uncertain(signals: dict[str, Any], th: dict[str, float]) -> bool:
    """Deterministic uncertainty rule (I19-S1, fail-closed on missing)."""
    lp = signals.get("min_avg_logprob")
    if lp is None:
        return True
    if lp < th["min_avg_logprob_floor"]:
        return True
    ns = signals.get("max_no_speech_prob")
    if ns is not None and ns > th["no_speech_prob_ceiling"]:
        return True
    cr = signals.get("max_compression_ratio")
    if cr is not None and cr > th["compression_ratio_ceiling"]:
        return True
    lang_p = signals.get("language_probability")
    if lang_p is not None and lang_p < th["language_probability_floor"]:
        return True
    return False
