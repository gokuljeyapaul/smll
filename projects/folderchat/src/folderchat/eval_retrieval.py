"""Retrieval evaluation (A03): recall@k and MRR of the gold supporting spans on the
fixture questions — per mode (hybrid / bm25 / vectors). Runnable as a module:
python -m folderchat.eval_retrieval"""
from __future__ import annotations

import re
from typing import Any


def _norm(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip().lower()


def recall_at_k(qa_lines: list[dict[str, Any]], mode: str, k: int, data_dir: Any,
                subset: int | None = None, embedder: Any = None) -> dict[str, Any]:
    """recall@k: the fraction of answerable questions where at least one gold span
    appears verbatim (whitespace-normalized) in a top-k chunk. MRR over the first
    gold-containing chunk. Unanswerable lines are ignored here."""
    from folderchat.retrieve import retrieve

    answerable = [e for e in qa_lines if e.get("gold_spans")]
    if subset:
        answerable = answerable[:subset]
    hits_at_k = 0
    rr_sum = 0.0
    n = len(answerable)
    for line in answerable:
        spans = [_norm(s["span"]) for s in line["gold_spans"]]
        found_rank = None
        for rank, chunk in enumerate(retrieve(line["question"], k=k, mode=mode,
                                               data_dir=data_dir, embedder=embedder), 1):
            text = _norm(chunk["text"])
            if any(s in text for s in spans):
                found_rank = rank
                break
        if found_rank is not None:
            hits_at_k += 1
            rr_sum += 1.0 / found_rank
    return {"mode": mode, "k": k, "questions": n, "recall_at_k": hits_at_k / n if n else 0.0,
            "mrr": rr_sum / n if n else 0.0}


def main() -> int:
    import json
    import pathlib
    import sys

    root = pathlib.Path(__file__).resolve().parents[2]
    qa = [json.loads(x) for x in (root / "fixtures" / "qa.jsonl").read_text(encoding="utf-8").splitlines() if x.strip()]
    from folderchat.config import data_dir

    mode = sys.argv[1] if len(sys.argv) > 1 else "hybrid"
    k = int(sys.argv[2]) if len(sys.argv) > 2 else 8
    print(json.dumps(recall_at_k(qa, mode, k, data_dir()), indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
