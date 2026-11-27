"""Embeddings: sentence-transformers over the pinned local model directory (gitignored
.cache/models/<repo-name>). E5-family models need query:/passage: prefixes; the pinned
prefixes travel in the model manifest entry."""
from __future__ import annotations

from functools import lru_cache
from typing import Any

from folderchat.config import load_manifest, models_dir


class Embedder:
    def __init__(self, model_dir: Any, query_prefix: str = "", passage_prefix: str = "") -> None:
        from sentence_transformers import SentenceTransformer

        self._model = SentenceTransformer(str(model_dir))
        self.query_prefix = query_prefix
        self.passage_prefix = passage_prefix
        dim = self._model.get_sentence_embedding_dimension()
        self.dim = int(dim) if dim is not None else 384

    def encode_passages(self, texts: list[str], batch_size: int = 32) -> list[list[float]]:
        if not texts:
            return []
        vecs = self._model.encode([self.passage_prefix + t for t in texts], batch_size=batch_size,
                                  normalize_embeddings=True, show_progress_bar=False)
        return [v.tolist() for v in vecs]

    def encode_query(self, text: str) -> list[float]:
        return self.encode_passages([self.query_prefix + text])[0]


@lru_cache(maxsize=2)
def _cached_embedder(model_dir: str, query_prefix: str, passage_prefix: str) -> Embedder:
    return Embedder(model_dir, query_prefix, passage_prefix)


def load_embedder(role: str = "embedding") -> Embedder:
    """Load the pinned embedding model for a manifest role (cached per process)."""
    entry = load_manifest()["roles"][role]
    model_dir = models_dir() / entry["repo"].split("/")[-1]
    return _cached_embedder(str(model_dir), entry.get("query_prefix", ""), entry.get("passage_prefix", ""))
