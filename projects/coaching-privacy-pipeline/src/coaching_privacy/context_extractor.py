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
from typing import Any

MODEL_ID = "urchade/gliner_medium-v2.1"

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

    def _ensure_loaded(self):
        if self._model is not None:
            return
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
            self._model = GLiNER.from_pretrained(
                self.model_path, local_files_only=True
            )
            self._model.eval()
        finally:
            socket.socket = orig_socket

    def extract(self, text: str, labels: list[str] | None = None) -> list[ContextSpan]:
        self._ensure_loaded()
        labels = labels or list(LABEL_MAP)
        raw = self._model.predict_entities(
            text, labels=labels, threshold=self._threshold
        )
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

    def model_info(self) -> dict[str, Any]:
        return {
            "model_id": MODEL_ID,
            "local_path": self.model_path,
            "local_only": True,
            "threshold": self._threshold,
        }


def _default_model_path() -> str:
    import pathlib

    return pathlib.Path(__file__).resolve().parents[2] / "models" / "gliner_medium-v2.1"
