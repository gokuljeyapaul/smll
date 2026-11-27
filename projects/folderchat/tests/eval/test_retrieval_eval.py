"""A03: retrieval quality — recall@8 >= 0.90 on answerable fixture questions,
with hybrid vs BM25-only vs vectors-only all recorded."""
import json
import os
import pathlib

EVAL_OUT = pathlib.Path("docs/evidence/S0/eval")


def _recall_at_k(qa_lines, mode, data_dir, k=8, subset=None):
    from folderchat.eval_retrieval import recall_at_k

    return recall_at_k(qa_lines, mode=mode, k=k, data_dir=data_dir, subset=subset)


def test_a03_recall_smoke_hybrid_meets_bar(data_dir, corpus_path, qa_lines):
    """CI slow subset: recall@8 (hybrid) >= 0.90 on the first 25 answerable questions."""
    from folderchat.config import data_dir as resolve_data_dir
    from folderchat.config import load_limits
    from folderchat.indexer import add_source

    add_source(str(corpus_path), load_limits(), data_dir=resolve_data_dir())
    metrics = _recall_at_k(qa_lines, "hybrid", resolve_data_dir(), subset=25)
    print(f"hybrid recall@8 (smoke subset): {metrics}")
    assert metrics["recall_at_k"] >= 0.90, metrics
    bm25 = _recall_at_k(qa_lines, "bm25", resolve_data_dir(), subset=25)
    vec = _recall_at_k(qa_lines, "vectors", resolve_data_dir(), subset=25)
    print(f"bm25-only recall@8: {bm25['recall_at_k']:.3f}  vectors-only recall@8: {vec['recall_at_k']:.3f}")


def test_a03_recall_full_eval_recorded(data_dir, corpus_path, qa_lines):
    """Host bench: the full >=150-question eval, all three modes recorded to evidence JSON."""
    import pytest

    if os.environ.get("FOLDERCHAT_RUN_BENCH") != "1":
        pytest.skip("full eval is a building-host bench run")
    from folderchat.config import data_dir as resolve_data_dir
    from folderchat.config import load_limits
    from folderchat.indexer import add_source

    add_source(str(corpus_path), load_limits(), data_dir=resolve_data_dir())
    out = {}
    for mode in ("hybrid", "bm25", "vectors"):
        out[mode] = _recall_at_k(qa_lines, mode, resolve_data_dir())
    assert out["hybrid"]["recall_at_k"] >= 0.90, out
    assert out["hybrid"]["questions"] >= 150, out
    EVAL_OUT.mkdir(parents=True, exist_ok=True)
    (EVAL_OUT / "retrieval_metrics.json").write_text(json.dumps(out, indent=2) + "\n")
    print(json.dumps(out, indent=2))
