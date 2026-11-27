"""A04/A06 (bench): the answer-selection eval — every candidate and the baseline, measured
on this project's fixtures, plus the ship-rule verdict. Building host only (FOLDERCHAT_RUN_BENCH=1)."""
import json
import os
import pathlib

import pytest

EVAL_OUT = pathlib.Path("docs/evidence/S0/eval")
CANDIDATES = ["pleias-rag-1b", "pleias-rag-350m", "occ-rag-1.7b", "granite-4.0-micro", "bm25-top-passage"]


def _model_path(name):
    import json as _json
    import os as _os
    import pathlib as _pathlib

    manifest_path = _pathlib.Path(_os.environ.get(
        "FOLDERCHAT_MANIFEST",
        _pathlib.Path(__file__).resolve().parents[2] / "scripts" / "model_manifest.json"))
    models_dir = _pathlib.Path(_os.environ.get(
        "FOLDERCHAT_MODEL_DIR",
        _pathlib.Path(__file__).resolve().parents[1] / ".cache" / "models"))
    manifest = _json.loads(manifest_path.read_text(encoding="utf-8"))
    entry = manifest["candidates"][name]
    if entry.get("kind") == "baseline":
        return None
    patch = entry.get("patch")
    patched = models_dir / patch["output_file"] if patch else None
    if patched is not None and patched.is_file():
        return patched
    p = models_dir / entry["file"]
    if not p.is_file():
        pytest.skip(f"candidate {name} not fetched: {p}")
    return p


@pytest.mark.parametrize("candidate", CANDIDATES)
def test_a04_candidate_eval(candidate, data_dir, corpus_path, qa_lines):
    """Run the answer eval for one candidate (or the baseline) and record its JSON.

    Full set by default is FOLDERCHAT_BENCH_FULL=1; the standard host bench uses the
    fixed stratified subset recorded in the output (same selection for every
    candidate), sized to the building host's measured CPU budget."""
    if os.environ.get("FOLDERCHAT_RUN_BENCH") != "1":
        pytest.skip("answer bench runs on the building host only")
    from folderchat.eval_answers import run_answer_eval

    subset = None
    if os.environ.get("FOLDERCHAT_BENCH_FULL") != "1":
        subset = {"answerable": 10, "unanswerable": 10, "injection": 3, "seed": 20261127}
    metrics = run_answer_eval(candidate, qa_lines, data_dir=data_dir, corpus=str(corpus_path),
                             model_path=_model_path(candidate), subset_spec=subset)
    EVAL_OUT.mkdir(parents=True, exist_ok=True)
    (EVAL_OUT / f"answers_{candidate}.json").write_text(json.dumps(metrics, indent=2) + "\n")
    for key in ("answer_f1", "exact_match", "citation_precision", "citation_recall",
                "abstention_f1", "latency_ttft_s_median_4t", "peak_rss_mb"):
        assert key in metrics, f"{candidate}: missing metric {key}"
    print(f"{candidate}: f1={metrics['answer_f1']:.3f} cite_prec={metrics['citation_precision']:.3f} "
          f"abstain_f1={metrics['abstention_f1']:.3f}")


def test_a04_ship_rule_applied_and_consistent():
    """The committed ship-rule verdict matches what the recorded numbers actually say."""
    if os.environ.get("FOLDERCHAT_RUN_BENCH") != "1":
        pytest.skip("ship-rule check runs on the building host only")
    verdict = json.loads((EVAL_OUT / "ship_rule.json").read_text(encoding="utf-8"))
    per_candidate = {c: json.loads((EVAL_OUT / f"answers_{c}.json").read_text(encoding="utf-8")) for c in CANDIDATES}
    baseline_f1 = per_candidate["bm25-top-passage"]["answer_f1"]
    eligible = []
    for c, m in per_candidate.items():
        if c == "bm25-top-passage":
            continue
        passes = (m["citation_precision"] >= 0.95 and m["abstention_f1"] >= 0.80
                  and m["answer_f1"] >= baseline_f1 + 0.10)
        if passes:
            eligible.append(c)
        if c == verdict.get("default_answer_candidate"):
            assert passes, f"{c} recorded as default but fails the ship rule"
    if verdict.get("default_mode") == "slm":
        assert verdict.get("default_answer_candidate") in eligible, "SLM mode recorded but no candidate is eligible"
    else:
        assert not eligible or verdict.get("default_answer_candidate") is None, \
            "an eligible candidate exists but passages mode was recorded"
    print(f"ship rule: default_mode={verdict['default_mode']} default={verdict.get('default_answer_candidate')}")


def test_a04_latency_pass_4_threads(data_dir, corpus_path):
    """The plan's latency measurement point: time to first token and full answer on
    4 CPU threads, per candidate, over 2 fixed questions (recorded with the host's
    load context; see model_selection.md for the contention numbers)."""
    if os.environ.get("FOLDERCHAT_RUN_BENCH") != "1":
        pytest.skip("answer bench runs on the building host only")
    import resource

    from folderchat.config import load_limits, load_manifest
    from folderchat.eval_answers import _wrap_prompt_family
    from folderchat.indexer import add_source
    from folderchat.retrieve import retrieve

    limits = load_limits()
    add_source(str(corpus_path), limits, data_dir=data_dir)
    manifest = load_manifest()
    out_path = EVAL_OUT / "latency.json"
    lat = {}
    if out_path.is_file():
        lat = json.loads(out_path.read_text(encoding="utf-8"))
    lat.setdefault("questions", ["What is the travel reimbursement limit?",
                                 "What is the 401k match?"])
    for candidate in CANDIDATES:
        if candidate == "bm25-top-passage" or candidate in lat:
            continue
        from folderchat.answer import AnswerEngine

        entry = manifest["candidates"][candidate]
        model_path = _model_path(candidate)
        if model_path is None:
            continue
        engine = AnswerEngine(manifest, model_path, n_threads=4, timeout_s=900)
        if entry.get("prompt_family", "pleias-rag") not in ("pleias-rag", "occ-rag"):
            engine = _wrap_prompt_family(engine, entry["prompt_family"])
        ttfts, fulls = [], []
        for q in lat["questions"]:
            hits = retrieve(q, k=limits.retrieve_top_k, mode="hybrid", data_dir=data_dir)
            r = engine.ask(q, hits[: limits.prompt_source_count])
            if r.latency_ttft_s is not None:
                ttfts.append(r.latency_ttft_s)
            if r.latency_full_s is not None:
                fulls.append(r.latency_full_s)
        engine.close()
        import statistics

        lat[candidate] = {
            "ttft_s_median_4t": statistics.median(ttfts) if ttfts else None,
            "full_s_median_4t": statistics.median(fulls) if fulls else None,
            "threads": 4,
            "peak_rss_mb": round(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024, 1),
        }
        print(f"{candidate}: ttft={lat[candidate]['ttft_s_median_4t']}s full={lat[candidate]['full_s_median_4t']}s")
    EVAL_OUT.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(lat, indent=2) + "\n")
