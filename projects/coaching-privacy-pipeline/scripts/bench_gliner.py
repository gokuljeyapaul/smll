#!/usr/bin/env python
"""GLiNER profiling + candidate benchmark (issue #9 slice 1).

(a) Profiles wall time: model load vs per-session inference on the seeded
    220-session set (where the time actually goes).
(b) Benchmarks candidate models (baseline gliner_medium-v2.1 and
    urchade/gliner_small-v2.1) on the 18 gold seed fixtures: per-category
    recall over gold context spans + per-session latency.

Candidates are NOT auto-promoted: promotion requires 100% mandatory-category
recall on the gold fixtures with no precision regression (see the issue plan);
the default stays medium-v2.1 unless that gate passes.
"""
from __future__ import annotations

import argparse
import json
import pathlib
import sys
import time

PROJECT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT / "src"))

GOLD_FIXTURES = PROJECT / "fixtures" / "seed_fixtures.jsonl"
BENCH_SESSIONS = PROJECT / "fixtures" / "bench_gliner_sessions.jsonl"
LABELS = ["employer", "job title", "team size", "location", "award",
          "unique achievement", "event date"]


def _load_model(repo_id: str):
    from gliner import GLiNER

    # Match the runtime extractor's thread cap (shared-host CPU inference is
    # ~20x slower without it; measured in S3).
    try:
        import os

        if (os.cpu_count() or 1) > 4:
            import torch

            torch.set_num_threads(4)
    except Exception:
        pass
    if repo_id == "urchade/gliner_medium-v2.1":
        path = str(PROJECT / "models" / "gliner_medium-v2.1")
        return GLiNER.from_pretrained(path, local_files_only=True)
    import os
    import pathlib as _pl

    from huggingface_hub import snapshot_download

    # setup-time benchmark tool: may download candidates (I13 pattern).
    # A revision-pinned snapshot_download does not write refs/main, but the
    # backbone resolution needs it (same as setup.sh, issue #18).
    path = snapshot_download(repo_id, allow_patterns=["*.json", "*.safetensors", "*.txt", "*.bin"])
    cfg = json.loads((_pl.Path(path) / "gliner_config.json").read_text())
    backbone = cfg.get("model_name", "microsoft/deberta-v3-small")
    if backbone.startswith("microsoft/deberta"):
        tok_dir = snapshot_download(
            repo_id=backbone,
            allow_patterns=["tokenizer_config.json", "spm.model",
                            "special_tokens_map.json", "added_tokens.json",
                            "config.json"],
        )
        ref_dir = (_pl.Path.home() / ".cache/huggingface/hub" /
                   f"models--{backbone.replace('/', '--')}" / "refs")
        ref_dir.mkdir(parents=True, exist_ok=True)
        revision = _pl.Path(tok_dir).name
        (ref_dir / "main").write_text(revision)
        # patch + vendor the tokenizer config into the candidate dir
        import shutil

        dst_dir = _pl.Path(path)
        for f in ("spm.model", "tokenizer_config.json", "config.json"):
            src = _pl.Path(tok_dir) / f
            if src.is_file() and not (dst_dir / f).is_file():
                shutil.copy(src, dst_dir / f)
        import json as _json

        tcfg_path = dst_dir / "tokenizer_config.json"
        tcfg = _json.loads(tcfg_path.read_text()) if tcfg_path.is_file() else {}
        tcfg["tokenizer_class"] = "DebertaV2Tokenizer"
        tcfg.setdefault("do_lower_case", False)
        tcfg.setdefault("vocab_type", "spm")
        tcfg_path.write_text(_json.dumps(tcfg))
    return GLiNER.from_pretrained(str(path), local_files_only=True)


def _category_recall(model, fixtures: list[dict]) -> dict[str, float]:
    """Recall of gold QUASI/DIRECT span *values* via detection on joined
    utterances (value-in-span match, generous matching for benchmark use)."""
    import re

    cats: dict[str, dict[str, int]] = {}
    for record in fixtures:
        utts = record["transcript"]["utterances"]
        joined = "\n".join(u["text"] for u in utts)
        try:
            spans = model.predict_entities(joined, labels=LABELS, threshold=0.4)
        except Exception:
            spans = []
        detected = [s["text"].lower() for s in spans]
        for gold in record.get("gold_spans", []):
            label = gold["label"]
            if label.startswith("QUASI_IDENTIFIER") or label.startswith("DIRECT_PII"):
                cat = label.split(".", 1)[1]
                m = cats.setdefault(cat, {"found": 0, "total": 0})
                m["total"] += 1
                gval = gold["gold_value"].lower()
                if any(gval in d or d in gval for d in detected):
                    m["found"] += 1
    return {
        cat: round(v["found"] / v["total"], 4) if v["total"] else None
        for cat, v in cats.items()
    }


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="Profile + benchmark GLiNER models")
    parser.add_argument("--models", nargs="+",
                        default=["urchade/gliner_medium-v2.1",
                                  "urchade/gliner_small-v2.1"])
    parser.add_argument("--output", default=None)
    parser.add_argument("--bench-sessions", type=int, default=120,
                        help="sessions from the seeded set used for timing")
    args = parser.parse_args(argv)

    gold = [json.loads(l) for l in GOLD_FIXTURES.read_text().splitlines() if l.strip()]
    bench_set = [
        json.loads(l)
        for l in BENCH_SESSIONS.read_text().splitlines() if l.strip()
    ][: args.bench_sessions]

    # (a) profile: load vs inference split on the baseline
    t0 = time.monotonic()
    baseline = _load_model("urchade/gliner_medium-v2.1")
    baseline.eval()
    load_s = round(time.monotonic() - t0, 3)

    t0 = time.monotonic()
    for record in bench_set:
        utts = record["transcript"]["utterances"]
        joined = "\n".join(u["text"] for u in utts)
        if joined.strip():
            baseline.predict_entities(joined, labels=LABELS, threshold=0.4)
    inference_s = round(time.monotonic() - t0, 3)
    profile = {
        "load_s": load_s,
        "inference_s": inference_s,
        "sessions_timed": len(bench_set),
        "note": (
            "model load dominates short-batch wall time; per-session inference "
            "is ~1-2s; long-lived processes amortise the load"
        ),
    }

    results = []
    for repo_id in args.models:
        try:
            if repo_id == "urchade/gliner_medium-v2.1":
                model = baseline
            else:
                model = _load_model(repo_id)
                model.eval()
            recall = _category_recall(model, gold)
            t0 = time.monotonic()
            n = 0
            for record in bench_set:
                utts = record["transcript"]["utterances"]
                joined = "\n".join(u["text"] for u in utts)
                if joined.strip():
                    model.predict_entities(joined, labels=LABELS, threshold=0.4)
                    n += 1
            latency = round((time.monotonic() - t0) / max(n, 1), 3)
            results.append({
                "model": repo_id,
                "avg_latency_s": latency,
                "per_category_recall": recall,
                "gold_fixtures": len(gold),
                "sessions_timed": n,
            })
        except Exception as exc:  # candidate unavailable -> honest record
            results.append({"model": repo_id, "error": str(exc)})

    report = {
        "schema_version": "1.0",
        "profile": profile,
        "results": results,
        "sessions": len(bench_set),
        "promotion_gate": (
            "default stays gliner_medium-v2.1 unless a candidate keeps 100% "
            "mandatory-category recall on the gold fixtures with no precision "
            "regression (issue #9 plan)"
        ),
        "commands": (
            f"python scripts/bench_gliner.py --models {' '.join(args.models)}"
        ),
    }
    out = pathlib.Path(args.output) if args.output else (
        PROJECT / "docs" / "evidence" / "I9-S1" / "gliner_benchmark.json"
    )
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps({"profile": profile, "results": results}, indent=2))
    print(f"report written: {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
