"""Real offline GLiNER Medium v2.1 span extraction (S3).

The pinned checkpoint is loaded from the local path with
local_files_only=True; no remote fallback ever occurs (fail closed). The
extractor is a span predictor only — it never executes transcript text and
never infers protected characteristics. Deterministic: greedy decoding,
fixed threshold.
"""
from __future__ import annotations

import dataclasses
import os
import pathlib
from typing import Any

MODEL_ID = "urchade/gliner_medium-v2.1"

# Issue #18 slice 2: runtime fail-closed model verification. Both adapters
# verify the manifest sha256 of the files they load, once per process, before
# touching the model. Missing/tampered files fail closed instead of loading.
_DEFAULT_MANIFEST = (
    pathlib.Path(__file__).resolve().parents[2] / "scripts" / "model_manifest.json"
)
_DEFAULT_MODELS_ROOT = pathlib.Path(__file__).resolve().parents[2] / "models"
_VERIFIED: set[str] = set()


def _model_manifest_path() -> pathlib.Path:
    return pathlib.Path(
        os.environ.get("COACHING_MODEL_MANIFEST", str(_DEFAULT_MANIFEST))
    )


def _verify_model_entry(model_key: str, resolved_dir: pathlib.Path) -> None:
    """Raise RuntimeError naming the offending file if the model directory's
    files do not match the pinned manifest (sha256). Runs once per
    (manifest, dir) per process; results cached on success only."""
    import hashlib
    import json

    cache_key = f"{model_key}:{resolved_dir}:{_model_manifest_path()}"
    if cache_key in _VERIFIED:
        return
    manifest_path = _model_manifest_path()
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise RuntimeError(
            f"model manifest missing: {manifest_path} (cannot verify {model_key})"
        ) from exc
    except json.JSONDecodeError as exc:
        raise RuntimeError(
            f"model manifest malformed: {manifest_path} ({exc})"
        ) from exc
    entry = manifest.get("models", {}).get(model_key)
    if not isinstance(entry, dict) or not entry.get("files"):
        raise RuntimeError(
            f"model manifest has no file entries for '{model_key}'"
        )
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

# GLiNER prompt label -> canonical quasi-identifier taxonomy
LABEL_MAP = {
    "employer": "QUASI_IDENTIFIER.EXACT_EMPLOYER",
    "job title": "QUASI_IDENTIFIER.RARE_ROLE",
    "rare role": "QUASI_IDENTIFIER.RARE_ROLE",
    "location": "QUASI_IDENTIFIER.PRECISE_LOCATION",
    "team size": "QUASI_IDENTIFIER.SMALL_TEAM",
    "unique achievement": "QUASI_IDENTIFIER.UNIQUE_ACHIEVEMENT",
    "award": "QUASI_IDENTIFIER.UNIQUE_ACHIEVEMENT",
    "event date": "QUASI_IDENTIFIER.EXACT_EVENT_DATE",
}


@dataclasses.dataclass(frozen=True)
class ContextSpan:
    start: int
    end: int
    label: str  # canonical, e.g. QUASI_IDENTIFIER.RARE_ROLE
    value: str
    gliner_label: str
    confidence: float


def validate_span(span: dict[str, Any]) -> None:
    """Fail closed on malformed model output (A12)."""
    if not isinstance(span, dict):
        raise ValueError(f"span must be dict, got {type(span)}")
    start, end = span.get("start"), span.get("end")
    if not isinstance(start, int) or not isinstance(end, int):
        raise ValueError(f"span offsets must be int, got {start!r},{end!r}")
    if end <= start:
        raise ValueError(f"malformed span: end<=start ({start},{end})")
    if not span.get("label"):
        raise ValueError("span missing label")


class GLiNERContextExtractor:
    def __init__(self, model_path: str | None = None, threshold: float = 0.4):
        self._threshold = threshold
        self._model = None
        self.model_path = model_path or os.environ.get(
            "COACHING_GLINER_PATH",
            str(_default_model_path()),
        )

    def _verify_model_files(self) -> None:
        """Issue #18 slice 2: fail closed if the checkpoint files do not
        match the pinned manifest before loading (once per process)."""
        _verify_model_entry("gliner_medium_v2_1", pathlib.Path(self.model_path))

    def _ensure_loaded(self):
        if self._model is not None:
            return
        self._verify_model_files()
        import socket

        # Fail closed: hard-block network during model load; local files only.
        class _Blocked:
            def __init__(self, *a, **k):
                raise OSError("network access disabled for GLiNER load")

        orig_socket = socket.socket
        socket.socket = _Blocked
        os.environ["HF_HUB_OFFLINE"] = "1"  # never resolve remote models
        try:
            import os as _os
            ncpu = _os.cpu_count() or 1
            if ncpu > 4:
                # Thread oversubscription on shared hosts makes CPU inference
                # ~20x slower; cap torch at 4 threads (measured).
                try:
                    import torch
                    torch.set_num_threads(4)
                except Exception:
                    pass
            from gliner import GLiNER

            # I9-S2: device="auto" uses CUDA when available; CPU fallback is
            # the unchanged default (no GPU on the reference environment).
            device = "cpu"
            try:
                import torch as _torch

                if _torch.cuda.is_available():
                    device = "cuda"
            except Exception:
                pass
            self._device = device
            self._model = GLiNER.from_pretrained(
                self.model_path, local_files_only=True
            )
            self._model.eval()
        finally:
            socket.socket = orig_socket

    def _to_spans(self, raw: list[dict]) -> list[ContextSpan]:
        spans: list[ContextSpan] = []
        for r in raw:
            validate_span(r)
            canonical = LABEL_MAP.get(r["label"], f"QUASI_IDENTIFIER.{r['label'].upper()}")
            spans.append(
                ContextSpan(
                    start=int(r["start"]),
                    end=int(r["end"]),
                    label=canonical,
                    value=r["text"],
                    gliner_label=r["label"],
                    confidence=round(float(r["score"]), 4),
                )
            )
        spans.sort(key=lambda s: (s.start, -(s.end - s.start)))
        return spans

    def extract(self, text: str, labels: list[str] | None = None) -> list[ContextSpan]:
        self._ensure_loaded()
        labels = labels or list(LABEL_MAP)
        raw = self._model.predict_entities(
            text, labels=labels, threshold=self._threshold
        )
        return self._to_spans(raw)

    def extract_batch(
        self, texts: list[str], labels: list[str] | None = None
    ) -> list[list[ContextSpan]]:
        """I9-S2: amortise the load/inference overhead — one batched
        inference call for all windows (labels shared). Span sets must be
        identical to serial extract() per text (CPU baseline asserted in
        tests/integration/test_i9s2_batch.py)."""
        self._ensure_loaded()
        if not texts:
            return []
        labels = labels or list(LABEL_MAP)
        raw_lists = self._model.inference(
            texts, labels=labels, threshold=self._threshold
        )
        return [self._to_spans(raw) for raw in raw_lists]

    def model_info(self) -> dict[str, Any]:
        return {
            "model_id": MODEL_ID,
            "local_path": self.model_path,
            "local_only": True,
            "threshold": self._threshold,
            "device": getattr(self, "_device", "cpu"),
        }


def _default_model_path() -> str:
    import pathlib

    return pathlib.Path(__file__).resolve().parents[2] / "models" / "gliner_medium-v2.1"
