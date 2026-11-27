"""Indexer: add a folder as a source — parse, chunk, embed, store (A02)."""
from __future__ import annotations

import datetime
import hashlib
import pathlib
from dataclasses import dataclass, field
from typing import Any

from folderchat import db
from folderchat.chunker import chunk_blocks
from folderchat.ingest import SUPPORTED_EXTENSIONS, parse_file


@dataclass
class AddReport:
    source_path: str
    indexed_files: int = 0
    skipped: list[dict[str, str]] = field(default_factory=list)
    chunks: int = 0
    files_seen: int = 0
    warned: bool = False

    def summary(self) -> str:
        lines = [f"Indexed {self.indexed_files} files ({self.chunks} chunks) from {self.source_path}."]
        if self.skipped:
            lines.append(f"Skipped {len(self.skipped)}:")
            for s in self.skipped:
                lines.append(f"  {s['relpath']} — {s['reason']}")
        if self.warned:
            lines.append("warning: large source — indexing took a while; expect a heavy index.")
        return "\n".join(lines)


class AddError(Exception):
    """Adding this folder is refused (missing path, over the per-source file limit)."""


def add_source(folder: str, limits: Any, data_dir: Any, embedder: Any = None, chunk_chars: int = 900) -> AddReport:
    """Index every supported file under folder (recursively). Files that cannot be
    indexed are listed with a specific reason, never silently dropped."""
    from folderchat.embedder import load_embedder

    root = pathlib.Path(folder).resolve()
    if not root.is_dir():
        raise AddError(f"folder not found: {root}")
    embedder = embedder or load_embedder()

    rel_files = sorted(
        p.relative_to(root).as_posix() for p in root.rglob("*")
        if p.is_file() and not any(part.startswith(".") for part in p.relative_to(root).parts))
    report = AddReport(source_path=str(root), files_seen=len(rel_files))
    if len(rel_files) > limits.max_files_per_source:
        raise AddError(
            f"too many files in source: {len(rel_files)} > {limits.max_files_per_source} (per-source limit)")
    if len(rel_files) > limits.warn_files_per_source:
        report.warned = True

    conn = db.open_db(data_dir, dim=embedder.dim)
    db.delete_source(conn, str(root))
    cur = conn.execute(
        "INSERT INTO sources(kind, path, added_at) VALUES('folder', ?, ?)",
        (str(root), datetime.datetime.now(datetime.UTC).isoformat()))
    assert cur.lastrowid is not None
    source_id = int(cur.lastrowid)

    for rel in rel_files:
        path = root / rel
        size = path.stat().st_size
        sha = hashlib.sha256(path.read_bytes()).hexdigest()
        parsed = parse_file(path, limits)
        cur = conn.execute(
            "INSERT INTO files(source_id, relpath, size_bytes, sha256, status, skip_reason, pages, chars) "
            "VALUES(?,?,?,?,?,?,?,?)",
            (source_id, rel, size, sha, parsed.status,
             parsed.reason if parsed.status == "skipped" else None,
             parsed.pages if parsed.status == "indexed" else None,
             parsed.chars if parsed.status == "indexed" else None))
        assert cur.lastrowid is not None
        file_id = int(cur.lastrowid)
        if parsed.status != "indexed":
            report.skipped.append({"relpath": rel, "reason": parsed.reason or "unknown reason"})
            continue
        report.indexed_files += 1
        blocks = [{"text": b.text, "page": b.page, "heading": b.heading} for b in parsed.blocks]
        for ord_, chunk in enumerate(chunk_blocks(blocks, max_chars=chunk_chars, overlap=120)):
            db.insert_chunk(conn, file_id, ord_, chunk.text, chunk.page, chunk.heading)
            report.chunks += 1
            if report.chunks % 512 == 0:
                conn.commit()
    conn.commit()

    # embed all chunks of this source (batched)
    rows = conn.execute(
        "SELECT c.id, c.text FROM chunks c JOIN files f ON c.file_id=f.id WHERE f.source_id=? ORDER BY c.id",
        (source_id,)).fetchall()
    B = 64
    for start in range(0, len(rows), B):
        batch = rows[start:start + B]
        vectors = embedder.encode_passages([r[1] for r in batch])
        db.add_embeddings(conn, [int(r[0]) for r in batch], vectors)
        conn.commit()
    db.bump_vec_sig(conn)
    conn.execute("UPDATE sources SET file_count=?, skipped_count=?, chunk_count=? WHERE id=?",
                 (report.indexed_files, len(report.skipped), report.chunks, source_id))
    conn.commit()
    conn.close()
    return report


def _supported(rel: str) -> bool:
    return pathlib.PurePosixPath(rel).suffix.lower() in SUPPORTED_EXTENSIONS
