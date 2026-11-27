"""D2 requires the vector index backend (sqlite-vec vs hnswlib) to be chosen by
measurement. This bench measures both on this project's fixture corpus: build time,
query time, and recall@8 against exact brute-force cosine — and records the numbers in
docs/evidence/S0/vector_index_choice.json. Gated: FOLDERCHAT_RUN_VECTOR_CHOICE=1."""
import json
import os
import pathlib
import time

import pytest

EVAL_OUT = pathlib.Path("docs/evidence/S0")


def test_vector_backend_choice_measured(data_dir, corpus_path):
    if os.environ.get("FOLDERCHAT_RUN_VECTOR_CHOICE") != "1":
        pytest.skip("vector backend choice runs in the S0 final evidence pass")

    import numpy as np

    from folderchat import db
    from folderchat.config import load_limits
    from folderchat.embedder import load_embedder
    from folderchat.indexer import add_source
    from folderchat.retrieve import retrieve

    add_source(str(corpus_path), load_limits(), data_dir=data_dir)
    embedder = load_embedder()

    conn = db.open_db(data_dir)
    rows = conn.execute("SELECT chunk_id, vec FROM chunk_vecs").fetchall()
    ids = [r[0] for r in rows]
    vecs = np.array([db.unpack_vector(r[1]) for r in rows], dtype=np.float32)
    queries = [embedder.encode_query(q) for q in (
        "What is the travel reimbursement limit?",
        "Who is the VP of Operations?",
        "When is the scanner rollout?",
        "What is the 401k match?",
        "How long is forklift certification valid?",
    )]
    conn.close()

    def exact_k(qvec, k=8):
        sims = vecs @ np.array(qvec, dtype=np.float32)
        order = np.argsort(-sims)[:k]
        return [int(ids[i]) for i in order]

    gold = {tuple(sorted(exact_k(q))) for q in queries}

    def measure(backend: str):
        os.environ["FOLDERCHAT_VECTOR_BACKEND"] = backend
        import importlib

        import folderchat.db as dbmod

        importlib.reload(dbmod)
        conn = dbmod.open_db(data_dir)
        t0 = time.monotonic()
        # build: sqlite-vec rows are already inserted at add time; hnsw builds lazily here
        dbmod.vector_search(conn, queries[0], 8)
        build_s = time.monotonic() - t0
        t0 = time.monotonic()
        overlap = 0
        for q in queries:
            hits = [cid for cid, _ in dbmod.vector_search(conn, q, 8)]
            if tuple(sorted(hits)) in gold:
                overlap += 1
        query_s = (time.monotonic() - t0) / len(queries)
        conn.close()
        # fresh-process sanity: query through the retrieve() path
        t0 = time.monotonic()
        retrieve("What is the travel reimbursement limit?", k=8, mode="vectors", data_dir=data_dir)
        full_query_s = time.monotonic() - t0
        return {"backend": backend, "first_query_build_s": round(build_s, 4),
                "mean_query_s": round(query_s, 4), "retrieve_path_query_s": round(full_query_s, 4),
                "recall_at_8_vs_exact": overlap / len(queries)}

    results = [measure("sqlite-vec"), measure("hnswlib")]
    out = {
        "measured_on": "S0 building host, fixtures/corpus (~60 files)",
        "chunks": len(ids), "dim": vecs.shape[1], "queries": len(queries),
        "metric": "recall@8 vs exact brute-force cosine (set equality over top-8 ids)",
        "results": results,
    }
    EVAL_OUT.mkdir(parents=True, exist_ok=True)
    (EVAL_OUT / "vector_index_choice.json").write_text(json.dumps(out, indent=2) + "\n")
    print(json.dumps(out, indent=2))
    # both backends must be measured and at least one must be perfectly faithful
    assert len(results) == 2
    assert any(r["recall_at_8_vs_exact"] == 1.0 for r in results)
