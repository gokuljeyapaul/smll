"""A02 (integration): adding a real folder builds the full index — slow: real embeddings."""
import json
import sqlite3


def test_add_corpus_reports_and_anchors(data_dir, corpus_path):
    from folderchat.config import data_dir as resolve_data_dir, load_limits
    from folderchat.indexer import add_source

    report = add_source(str(corpus_path), load_limits(), data_dir=resolve_data_dir())
    assert report.indexed_files > 40, f"expected the ~60-file corpus indexed, got {report.indexed_files}"
    assert report.chunks > 100
    skipped = {s["relpath"]: s["reason"] for s in report.skipped}
    assert any("encrypted" in r.lower() for r in skipped.values()), skipped
    assert any("unsupported" in r.lower() for r in skipped.values()), skipped

    db = sqlite3.connect(resolve_data_dir() / "index.db")
    f = {row[0]: row for row in db.execute("SELECT relpath, status, skip_reason FROM files").fetchall()}
    db.close()
    assert f["handbook.pdf"][1] == "indexed"
    assert f["secrets_encrypted.pdf"][1] == "skipped"


def test_bm25_retrieval_finds_gold_chunk(data_dir, corpus_path):
    """End-to-end ingest -> BM25 query finds the chunk containing the gold span."""
    from folderchat.config import data_dir as resolve_data_dir, load_limits
    from folderchat.indexer import add_source
    from folderchat.retrieve import retrieve

    add_source(str(corpus_path), load_limits(), data_dir=resolve_data_dir())
    hits = retrieve("What is the travel reimbursement limit?", k=8, mode="bm25", data_dir=resolve_data_dir())
    assert hits, "no BM25 hits"
    assert any("500" in h["text"] for h in hits[:3]), [h["text"][:60] for h in hits[:3]]
