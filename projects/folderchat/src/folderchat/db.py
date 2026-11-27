"""SQLite storage: sources, files, chunks, FTS5 (BM25), and the vector index.

Vector backend (chosen by measurement, S0): both sqlite-vec and hnswlib are fully
implemented and were measured on this project's fixtures — build time, query time,
and recall@8 against exact brute-force cosine (see
docs/evidence/S0/vector_index_choice.json). The winner is the shipped default;
switch with FOLDERCHAT_VECTOR_BACKEND. Embeddings are always persisted as BLOBs in
the chunk_vecs table so either backend can be (re)built from the database, and the
whole index stays in the data dir (D9)."""
from __future__ import annotations

import json
import os
import pathlib
import sqlite3
import struct
from typing import Any

SCHEMA = """
CREATE TABLE IF NOT EXISTS sources(
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL DEFAULT 'folder',
  path TEXT NOT NULL,
  added_at TEXT NOT NULL,
  file_count INTEGER NOT NULL DEFAULT 0,
  skipped_count INTEGER NOT NULL DEFAULT 0,
  chunk_count INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS sources_path ON sources(path);
CREATE TABLE IF NOT EXISTS files(
  id INTEGER PRIMARY KEY,
  source_id INTEGER NOT NULL,
  relpath TEXT NOT NULL,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  sha256 TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'indexed',
  skip_reason TEXT,
  pages INTEGER,
  chars INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS files_source_rel ON files(source_id, relpath);
CREATE TABLE IF NOT EXISTS chunks(
  id INTEGER PRIMARY KEY,
  file_id INTEGER NOT NULL,
  ord INTEGER NOT NULL,
  text TEXT NOT NULL,
  page INTEGER,
  heading TEXT
);
CREATE INDEX IF NOT EXISTS chunks_file ON chunks(file_id);
CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(text, chunk_id UNINDEXED);
CREATE TABLE IF NOT EXISTS chunk_vecs(
  chunk_id INTEGER PRIMARY KEY,
  dim INTEGER NOT NULL,
  vec BLOB NOT NULL
);
CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value BLOB);
"""

VECTOR_BACKEND = os.environ.get("FOLDERCHAT_VECTOR_BACKEND", "sqlite-vec")


def pack_vector(vec: list[float]) -> bytes:
    return struct.pack(f"<{len(vec)}f", *vec)


def unpack_vector(blob: bytes) -> list[float]:
    n = len(blob) // 4
    return list(struct.unpack(f"<{n}f", blob))


def open_db(data_dir: pathlib.Path | str, dim: int | None = None) -> sqlite3.Connection:
    data_dir = pathlib.Path(data_dir)
    data_dir.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(data_dir / "index.db")
    conn.execute("PRAGMA journal_mode=WAL")
    conn.executescript(SCHEMA)
    if VECTOR_BACKEND == "sqlite-vec":
        import sqlite_vec  # type: ignore[import-untyped]

        conn.enable_load_extension(True)
        sqlite_vec.load(conn)
        conn.enable_load_extension(False)
        stored = _stored_dim(conn)
        if dim is not None and stored is not None and stored != dim:
            conn.execute("DROP TABLE IF EXISTS chunks_vec")
            set_meta(conn, "vec_dim", None)
        if dim is not None and _stored_dim(conn) is None:
            conn.execute(
                f"CREATE VIRTUAL TABLE IF NOT EXISTS chunks_vec "
                f"USING vec0(chunk_id INTEGER PRIMARY KEY, embedding float[{dim}])")
            set_meta(conn, "vec_dim", dim)
    return conn


def _stored_dim(conn: sqlite3.Connection) -> int | None:
    v = get_meta(conn, "vec_dim")
    return None if v is None else int(v)


def get_meta(conn: sqlite3.Connection, key: str) -> str | None:
    row = conn.execute("SELECT value FROM meta WHERE key=?", (key,)).fetchone()
    if row is None:
        return None
    val = row[0]
    return val.decode() if isinstance(val, bytes) else str(val)


def set_meta(conn: sqlite3.Connection, key: str, value: Any) -> None:
    blob = value if isinstance(value, (bytes, bytearray)) else json.dumps(value)
    conn.execute("INSERT INTO meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                 (key, blob))


def delete_source(conn: sqlite3.Connection, source_path: str) -> None:
    """Purge a source and every chunk/embedding of it (re-add, D9 removal semantics)."""
    row = conn.execute("SELECT id FROM sources WHERE path=?", (source_path,)).fetchone()
    if row is None:
        return
    sid = int(row[0])
    conn.execute("DELETE FROM chunks_fts WHERE chunk_id IN "
                 "(SELECT c.id FROM chunks c JOIN files f ON c.file_id=f.id WHERE f.source_id=?)", (sid,))
    conn.execute("DELETE FROM chunks WHERE file_id IN (SELECT id FROM files WHERE source_id=?)", (sid,))
    conn.execute("DELETE FROM chunks_vec WHERE chunk_id IN "
                 "(SELECT c.id FROM chunks c JOIN files f ON c.file_id=f.id WHERE f.source_id=?)", (sid,))
    conn.execute("DELETE FROM chunk_vecs WHERE chunk_id IN "
                 "(SELECT c.id FROM chunks c JOIN files f ON c.file_id=f.id WHERE f.source_id=?)", (sid,))
    conn.execute("DELETE FROM files WHERE source_id=?", (sid,))
    conn.execute("DELETE FROM sources WHERE id=?", (sid,))
    conn.commit()


def insert_chunk(conn: sqlite3.Connection, file_id: int, ord_: int, text: str,
                 page: int | None, heading: str | None) -> int:
    cur = conn.execute("INSERT INTO chunks(file_id, ord, text, page, heading) VALUES(?,?,?,?,?)",
                       (file_id, ord_, text, page, heading))
    assert cur.lastrowid is not None
    chunk_id = int(cur.lastrowid)
    conn.execute("INSERT INTO chunks_fts(text, chunk_id) VALUES(?,?)", (text, chunk_id))
    return chunk_id


def add_embeddings(conn: sqlite3.Connection, chunk_ids: list[int], vectors: list[list[float]]) -> None:
    if not chunk_ids:
        return
    dim = len(vectors[0])
    for cid, vec in zip(chunk_ids, vectors, strict=False):
        blob = pack_vector(vec)
        conn.execute("INSERT OR REPLACE INTO chunk_vecs(chunk_id, dim, vec) VALUES(?,?,?)", (cid, dim, blob))
        if VECTOR_BACKEND == "sqlite-vec":
            conn.execute("INSERT OR REPLACE INTO chunks_vec(chunk_id, embedding) VALUES(?,?)", (cid, blob))
    set_meta(conn, "vec_dim", dim)


def vector_search(conn: sqlite3.Connection, query_vec: list[float], k: int) -> list[tuple[int, float]]:
    """Return [(chunk_id, distance)] for the k nearest chunks (cosine distance)."""
    if VECTOR_BACKEND == "sqlite-vec":
        exists = conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='chunks_vec'").fetchone()
        if not exists:
            return []  # nothing indexed yet (fail closed, never crash the ask)
        rows = conn.execute(
            "SELECT chunk_id, distance FROM chunks_vec WHERE embedding MATCH ? AND k = ? ORDER BY distance",
            (pack_vector(query_vec), k)).fetchall()
        return [(int(r[0]), float(r[1])) for r in rows]
    return _hnsw_search(conn, query_vec, k)


def _hnsw_search(conn: sqlite3.Connection, query_vec: list[float], k: int) -> list[tuple[int, float]]:
    """hnswlib backend: index built from chunk_vecs, persisted next to the DB, rebuilt when stale."""
    import hnswlib

    db_file = pathlib.Path(conn.execute("PRAGMA database_list").fetchall()[0][2])
    idx_path = db_file.parent / "vector.hnsw"
    dim = len(query_vec)
    n_stored = int(conn.execute("SELECT COUNT(*) FROM chunk_vecs").fetchone()[0])
    stored_sig = f"{n_stored}:{get_meta(conn, 'vec_sig') or ''}"
    index = hnswlib.Index(space="cosine", dim=dim)
    if idx_path.is_file() and get_meta(conn, "hnsw_sig") == stored_sig and get_meta(conn, "hnsw_dim") == str(dim):
        index.load_index(str(idx_path), max_elements=max(n_stored * 2, 1024))
    else:
        rows = conn.execute("SELECT chunk_id, vec FROM chunk_vecs").fetchall()
        index.init_index(max_elements=max(1024, len(rows) * 2), M=16, ef_construction=200)
        if rows:
            index.add_items([unpack_vector(r[1]) for r in rows], [r[0] for r in rows])
        index.save_index(str(idx_path))
        set_meta(conn, "hnsw_sig", stored_sig)
        set_meta(conn, "hnsw_dim", dim)
        conn.commit()
    labels, distances = index.knn_query([query_vec], k=k)
    return [(int(lbl), float(dst)) for lbl, dst in zip(labels[0], distances[0], strict=False)]


def bump_vec_sig(conn: sqlite3.Connection) -> None:
    import time

    set_meta(conn, "vec_sig", str(time.time()))
    conn.commit()


def chunk_rows_by_ids(conn: sqlite3.Connection, chunk_ids: list[int]) -> list[dict[str, Any]]:
    if not chunk_ids:
        return []
    marks = ",".join("?" * len(chunk_ids))
    rows = conn.execute(
        f"SELECT c.id, c.text, c.page, c.heading, f.relpath FROM chunks c "
        f"JOIN files f ON c.file_id=f.id WHERE c.id IN ({marks})", chunk_ids).fetchall()
    return [{"chunk_id": r[0], "text": r[1], "page": r[2], "heading": r[3], "file": r[4]} for r in rows]
