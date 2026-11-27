"""A04/A06 (bench): the answer-selection eval — every candidate and the baseline, measured
on this project's fixtures, plus the ship-rule verdict. Building host only (FOLDERCHAT_RUN_BENCH=1)."""
import json
import os
import pathlib

import pytest

EVAL_OUT = pathlib.Path("docs/evidence/S0/eval")
CANDIDATES = ["pleias-rag-1b-q4km", "pleias-rag-350m", "occ-rag-1.7b", "granite-4.0-micro", "bm25-top-passage"]


def _model_path(name):
    manifest_path = pathlib.Path(os.environ.get(
        "FOLDERCHAT_MANIFEST",
        pathlib.Path(__file__).resolve().parents[2] / "scripts" / "model_manifest.json"))
    models_dir = pathlib.Path(os.environ.get(
        "FOLDERCHAT_MODEL_DIR",
        pathlib.Path(__file__).resolve().parents[1] / ".cache" / "models"))
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    entry = manifest["candidates"][name]
    if entry.get("kind") == "baseline":
        return None
    p = models_dir / entry["file"]
    if not p.is_file():
        pytest.skip(f"candidate {name} not fetched: {p}")
    return p


@pytest.mark.parametrize("candidate", CANDIDATES)
def test_a04_candidate_eval(candidate, data_dir, corpus_path, qa_lines):
    """Run the full answer eval for one candidate (or the baseline) and record its JSON."""
    if os.environ.get("FOLDERCHAT_RUN_BENCH") != "1":
        pytest.skip("answer bench runs on the building host only")
    from folderchat.eval_answers import run_answer_eval

    metrics = run_answer_eval(candidate, qa_lines, data_dir=data_dir, corpus=str(corpus_path),
                             model_path=_model_path(candidate))
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
