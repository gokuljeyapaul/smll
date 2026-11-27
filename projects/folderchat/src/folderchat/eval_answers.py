"""The answer-selection eval (A04/A06): every candidate and the BM25 baseline, measured
on this project's fixtures with the plan's metrics:
  answer correctness  — token-level F1 and exact match vs the gold answer
  citation precision — displayed citations whose quote is a verbatim substring of the
                        cited chunk / all displayed citations (machine-verified)
  citation recall     — claims (sentences) carrying at least one verified citation
  abstention F1       — on the unanswerable questions (predicting 'not found')
  latency             — time to first token and full answer, median on 4 CPU threads
  peak RAM            — ru_maxrss of the bench process
Multi-hop gold-citation coverage and injection-payload leakage are recorded too
(their verdicts belong to later slices; here they are measured, not judged)."""
from __future__ import annotations

import os
import re
import resource
import statistics
import time
from typing import Any

_WORD = re.compile(r"[a-z0-9$%]+")


def _tokens(text: str) -> list[str]:
    return _WORD.findall(text.lower())


def token_f1(pred: str, gold: str) -> float:
    p, g = _tokens(pred), _tokens(gold)
    if not p or not g:
        return 1.0 if not p and not g else 0.0
    common: dict[str, int] = {}
    for t in g:
        common[t] = common.get(t, 0) + 1
    overlap = 0
    for t in p:
        if common.get(t, 0) > 0:
            overlap += 1
            common[t] -= 1
    precision = overlap / len(p)
    recall = overlap / len(g)
    return 2 * precision * recall / (precision + recall) if precision + recall else 0.0


def exact_match(pred: str, gold: str) -> bool:
    return " ".join(_tokens(pred)) == " ".join(_tokens(gold))


def _claims(text: str) -> list[str]:
    return [s.strip() for s in re.split(r"(?<=[.!?])\s+", text) if s.strip()]


def run_answer_eval(candidate: str, qa_lines: list[dict[str, Any]], data_dir: Any, corpus: str,
                    model_path: Any = None, threads: int = 0, latency_threads: int = 4,
                    latency_subset: int = 20, max_questions: int | None = None,
                    subset_spec: dict[str, int] | None = None) -> dict[str, Any]:
    """Evaluate one candidate (or 'bm25-top-passage') over the fixture QA set.

    subset_spec: when the building host cannot run the full eval (measured CPU quota +
    contention), a fixed stratified subset {answerable, unanswerable, injection, seed}
    is used — the same selection for every candidate (fair fight), recorded with the
    question ids in the output. None = the full set."""
    import random as _random

    from folderchat.config import load_limits, load_manifest
    from folderchat.indexer import add_source
    from folderchat.retrieve import retrieve

    limits = load_limits()
    manifest = load_manifest()
    is_baseline = candidate == "bm25-top-passage"

    t0 = time.monotonic()
    add_source(corpus, limits, data_dir=data_dir)
    index_seconds = time.monotonic() - t0

    engine = None
    prompt_family = "baseline"
    if not is_baseline:
        from folderchat.answer import AnswerEngine

        entry = manifest["candidates"][candidate]
        prompt_family = entry.get("prompt_family", "pleias-rag")
        engine = AnswerEngine(manifest, model_path, n_threads=threads)
        if prompt_family not in ("pleias-rag", "occ-rag"):
            engine = _wrap_prompt_family(engine, prompt_family)

    answerable = [e for e in qa_lines if e["type"] in ("answerable", "multihop")]
    unanswerable = [e for e in qa_lines if e["type"] == "unanswerable"]
    injection = [e for e in qa_lines if e["type"] == "injection"]
    subset_ids: list[str] = []
    if subset_spec:
        rng = _random.Random(subset_spec.get("seed", 20261127))

        def pick(lines: list[dict[str, Any]], n: int) -> list[dict[str, Any]]:
            ordered = sorted(lines, key=lambda e: e["id"])
            if len(ordered) <= n:
                return ordered
            return sorted(rng.sample(ordered, n), key=lambda e: ordered.index(e))

        answerable = pick(answerable, int(subset_spec.get("answerable", len(answerable))))
        unanswerable = pick(unanswerable, int(subset_spec.get("unanswerable", len(unanswerable))))
        injection = pick(injection, int(subset_spec.get("injection", len(injection))))
        subset_ids = [e["id"] for e in answerable + unanswerable + injection]
    if max_questions:
        answerable = answerable[:max_questions]

    if threads <= 0:
        # threads=0 (the default) means "take the bench threads from the environment":
        # parallel per-candidate workers pin FOLDERCHAT_BENCH_THREADS=1 (one core each
        # on the 4-CPU cgroup); unset defaults to 16 for a single big-machine run.
        threads = int(os.environ.get("FOLDERCHAT_BENCH_THREADS", "16"))

    f1s: list[float] = []
    ems: list[bool] = []
    displayed_cites = 0
    verified_cites = 0
    claims_supported: list[float] = []
    gold_cited_files: list[bool] = []
    sample_answers: list[dict[str, Any]] = []

    for line in answerable:
        hits = retrieve(line["question"], k=limits.retrieve_top_k, mode="hybrid", data_dir=data_dir)
        result = _answer(engine, line, hits, limits) if not is_baseline else None
        if result is None or result["not_found"]:
            f1s.append(0.0)
            ems.append(False)
            claims_supported.append(0.0)
            gold_cited_files.append(False)
            continue
        f1s.append(token_f1(result["answer_text"], line["gold_answer"]))
        ems.append(exact_match(result["answer_text"], line["gold_answer"]))
        displayed_cites += result["displayed_citations"]
        verified_cites += result["verified_citations"]
        if result["claims_total"]:
            claims_supported.append(result["claims_supported"] / result["claims_total"])
        gold_files = {s["file"] for s in line["gold_spans"]}
        cited_files = set(result["cited_files"])
        gold_cited_files.append(bool(gold_files & cited_files))
        if len(sample_answers) < 12:
            sample_answers.append({
                "question": line["question"], "gold": line["gold_answer"], "answer": result["answer_text"][:600],
                "citations": result["citations"][:4], "type": line["type"]})

    abstained_unanswerable = 0
    not_found_samples: list[str] = []
    for line in unanswerable:
        hits = retrieve(line["question"], k=limits.retrieve_top_k, mode="hybrid", data_dir=data_dir)
        result = _answer(engine, line, hits, limits) if not is_baseline else None
        if result is None or result["not_found"]:
            abstained_unanswerable += 1
            if len(not_found_samples) < 4:
                not_found_samples.append(line["question"])

    answered_answerable = sum(1 for f in f1s if f > 0)
    abstention_precision = (abstained_unanswerable / (abstained_unanswerable + answered_answerable)
                            if (abstained_unanswerable + answered_answerable) else 0.0)
    abstention_recall = abstained_unanswerable / len(unanswerable) if unanswerable else 0.0
    abstention_f1 = (2 * abstention_precision * abstention_recall / (abstention_precision + abstention_recall)
                     if abstention_precision + abstention_recall else 0.0)

    injection_leaks = 0
    for line in injection:
        hits = retrieve(line["question"], k=limits.retrieve_top_k, mode="hybrid", data_dir=data_dir)
        result = _answer(engine, line, hits, limits) if not is_baseline else None
        if result and not result["not_found"] and line.get("injection_marker", "") in result["answer_text"]:
            injection_leaks += 1

    latency: dict[str, Any] = {"ttft_s_median": None, "full_s_median": None, "threads": latency_threads}
    if engine is not None:
        engine.close()
        engine = AnswerEngine(manifest, model_path, n_threads=latency_threads)
        if prompt_family != "pleias-rag":
            engine = _wrap_prompt_family(engine, prompt_family)
        ttfts, fulls = [], []
        for line in answerable[:latency_subset]:
            hits = retrieve(line["question"], k=limits.retrieve_top_k, mode="hybrid", data_dir=data_dir)
            r = engine.ask(line["question"], hits[: limits.prompt_source_count])
            if r.latency_ttft_s is not None:
                ttfts.append(r.latency_ttft_s)
            fulls.append(r.latency_full_s or 0.0)
        latency["ttft_s_median"] = statistics.median(ttfts) if ttfts else None
        latency["full_s_median"] = statistics.median(fulls) if fulls else None
        engine.close()

    peak_rss_mb = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024.0
    return {
        "candidate": candidate,
        "model_path": str(model_path) if model_path else None,
        "prompt_family": prompt_family,
        "bench_subset": {"spec": subset_spec, "question_ids": subset_ids} if subset_spec else None,
        "questions_answerable": len(answerable),
        "questions_unanswerable": len(unanswerable),
        "questions_injection": len(injection),
        "answer_f1": sum(f1s) / len(f1s) if f1s else 0.0,
        "exact_match": sum(ems) / len(ems) if ems else 0.0,
        "citation_precision": (verified_cites / displayed_cites) if displayed_cites else 0.0,
        "citation_recall": (sum(claims_supported) / len(claims_supported)) if claims_supported else 0.0,
        "gold_source_cited_rate": (sum(gold_cited_files) / len(gold_cited_files)) if gold_cited_files else 0.0,
        "abstention_precision": abstention_precision,
        "abstention_recall": abstention_recall,
        "abstention_f1": abstention_f1,
        "injection_leak_rate": (injection_leaks / len(injection)) if injection else 0.0,
        "latency_ttft_s_median_4t": latency["ttft_s_median"],
        "latency_full_s_median_4t": latency["full_s_median"],
        "index_build_seconds": round(index_seconds, 2),
        "peak_rss_mb": round(peak_rss_mb, 1),
        "sample_answers": sample_answers,
        "not_found_samples": not_found_samples,
        "tested_with": {"threads_bulk_eval": threads, "threads_latency": latency_threads},
    }


def _answer(engine: Any, line: dict[str, Any], hits: list[dict[str, Any]], limits: Any) -> dict[str, Any]:
    result = engine.ask(line["question"], hits[: limits.prompt_source_count])
    if result.not_found:
        return {"not_found": True}
    claims = _claims(result.answer_text)
    supported = sum(1 for c in claims if any(cite_q in c for cite_q in
                                             [q["quote"] for q in result.citations]))
    return {
        "not_found": False,
        "answer_text": result.answer_text,
        "displayed_citations": len(result.citations),
        "verified_citations": len(result.citations),  # engine only keeps verified ones
        "claims_total": len(claims),
        "claims_supported": supported,
        "cited_files": [c["file"] for c in result.citations],
        "citations": [{"file": c["file"], "page": c["page"], "quote": c["quote"][:200]} for c in result.citations],
    }


def _wrap_prompt_family(engine: Any, family: str) -> Any:
    """Non-native candidates get the same grounded instruction contract (quote-support
    or abstain) so the measured comparison is about the model, not the harness; their
    citations are still machine-verified the same way. OCC-RAG and Pleias-RAG use
    their own native structural formats handled in answer.py."""
    if family in ("granite-chat",):
        engine.prompt_family = family
        original_assemble = engine.assemble_prompt

        def assemble(question: str, passages: list[dict[str, Any]]) -> dict[str, Any]:
            assembled = original_assemble(question, passages)
            sources = "\n\n".join(f"[{p['source_id']}] {p['text']}" for p in assembled["included"])
            prompt = (
                "Answer ONLY from the numbered sources below. Support each claim by quoting the "
                "exact source sentence in a <ref name=\"N\">quoted text</ref> tag, where N is the "
                "source number. If the sources do not contain the answer, reply exactly: "
                "I cannot find this in the provided documents.\n\n"
                f"Question: {question}\n\nSources:\n{sources}\n\nAnswer:")
            return {**assembled, "prompt": prompt}

        engine.assemble_prompt = assemble
        del original_assemble
        return engine
    return engine
