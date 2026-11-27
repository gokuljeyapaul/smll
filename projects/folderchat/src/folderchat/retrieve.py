"""Hybrid retrieval: FTS5 BM25 + vector cosine, merged with reciprocal rank fusion (A03)."""
from __future__ import annotations

import re
from typing import Any

from folderchat import db

_WORD = re.compile(r"[a-z0-9$%]+")


def _fts_query(question: str) -> str:
    terms = _WORD.findall(question.lower())
    if not terms:
        return ""
    return " OR ".join(f'"{t}"' for t in terms[:24])


def retrieve(question: str, k: int = 8, mode: str = "hybrid", data_dir: Any = None,
             conn: Any = None, embedder: Any = None) -> list[dict[str, Any]]:
    """Top-k chunks for a question.

    mode: 'bm25' | 'vectors' | 'hybrid' (RRF over both ranked lists, k=60).
    Returns chunk dicts with chunk_id/text/page/heading/file and a mode-dependent score."""
    from folderchat.config import data_dir as default_data_dir
    from folderchat.embedder import load_embedder

    data_dir = data_dir or default_data_dir()
    embedder = embedder or load_embedder()
    own_conn = conn is None
    conn = conn or db.open_db(data_dir)
    try:
        bm25_hits: list[tuple[int, float]] = []
        if mode in ("bm25", "hybrid"):
            q = _fts_query(question)
            if q:
                rows = conn.execute(
                    "SELECT chunk_id, bm25(chunks_fts) FROM chunks_fts WHERE chunks_fts MATCH ? "
                    "ORDER BY bm25(chunks_fts) LIMIT ?", (q, k * 2)).fetchall()
                bm25_hits = [(int(r[0]), float(r[1])) for r in rows]
        vec_hits: list[tuple[int, float]] = []
        if mode in ("vectors", "hybrid"):
            vec_hits = db.vector_search(conn, embedder.encode_query(question), k=k * 2)

        if mode == "bm25":
            ranked = [c for c, _ in bm25_hits[:k]]
        elif mode == "vectors":
            ranked = [c for c, _ in vec_hits[:k]]
        else:
            rrf: dict[int, float] = {}
            for rank, (cid, _) in enumerate(bm25_hits):
                rrf[cid] = rrf.get(cid, 0.0) + 1.0 / (60 + rank + 1)
            for rank, (cid, _) in enumerate(vec_hits):
                rrf[cid] = rrf.get(cid, 0.0) + 1.0 / (60 + rank + 1)
            ranked = [cid for cid, _ in sorted(rrf.items(), key=lambda t: -t[1])[:k]]

        rows = {r["chunk_id"]: r for r in db.chunk_rows_by_ids(conn, ranked)}
        return [rows[cid] for cid in ranked if cid in rows]
    finally:
        if own_conn:
            conn.close()
