#!/usr/bin/env python
"""German multilingual evaluation (issue #11 slice 2).

Evaluates (a) Presidio with a German spaCy NLP engine (de_core_news_sm) for
DIRECT_PII, and (b) GLiNER multi-v2.1 for quasi-identifier categories, on
fixtures/german_fixtures.jsonl against gold spans. Gate: German ships in
SUPPORTED_LANGUAGES only if mandatory-category recall equals the English
bar; otherwise the language gate stays and this evaluation is the honest
deliverable. TTS/synthetic-only caveat applies to all numbers.
"""
from __future__ import annotations

import argparse
import json
import pathlib
import sys

PROJECT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT / "src"))

FIXTURES = PROJECT / "fixtures" / "german_fixtures.jsonl"
LABELS = ["employer", "job title", "team size", "location", "award",
          "unique achievement", "event date"]


def eval_presidio_de(records: list[dict]) -> dict:
    from presidio_analyzer import AnalyzerEngine, RecognizerRegistry
    from presidio_analyzer.nlp_engine import NlpEngineProvider

    provider = NlpEngineProvider(nlp_configuration={
        "nlp_engine_name": "spacy",
        "models": [{"lang_code": "de", "model_name": "de_core_news_sm"}],
    })
    engine = provider.create_engine()
    analyzer = AnalyzerEngine(registry=RecognizerRegistry(supported_languages=["de"]),
                              nlp_engine=engine,
                              supported_languages=["de"])
    per_cat: dict[str, dict[str, int]] = {}
    for record in records:
        utts = record["transcript"]["utterances"]
        for u in utts:
            results = analyzer.analyze(text=u["text"], language="de")
            detected = {r.entity_type for r in results}
            for gold in record["gold_spans"]:
                if gold["utterance_id"] != u["id"]:
                    continue
                cat = gold["label"].split(".", 1)[1]
                m = per_cat.setdefault(cat, {"found": 0, "total": 0})
                if cat in {"PERSON", "EMAIL", "PHONE"}:
                    m["total"] += 1
                    wanted = {"PERSON": "PERSON", "EMAIL": "EMAIL",
                              "PHONE": "PHONE"}[cat]
                    if wanted in detected:
                        m["found"] += 1
    return per_cat


def eval_gliner_multi(records: list[dict]) -> dict:
    from huggingface_hub import snapshot_download
    import json as _json
    import os
    import pathlib as _pl
    import shutil

    path = snapshot_download("urchade/gliner_multi-v2.1",
                             allow_patterns=["*.json", "*.safetensors",
                                             "*.txt", "*.bin"])
    cfg = _json.loads((_pl.Path(path) / "gliner_config.json").read_text())
    tok_dir = snapshot_download(cfg["model_name"],
                                allow_patterns=["tokenizer_config.json",
                                                "spm.model",
                                                "special_tokens_map.json",
                                                "added_tokens.json",
                                                "config.json"])
    ref_dir = (_pl.Path.home() / ".cache/huggingface/hub" /
               f"models--{cfg['model_name'].replace('/', '--')}" / "refs")
    ref_dir.mkdir(parents=True, exist_ok=True)
    (ref_dir / "main").write_text(_pl.Path(tok_dir).name)
    dst = _pl.Path(path)
    for f in ("spm.model", "tokenizer_config.json", "config.json"):
        src = _pl.Path(tok_dir) / f
        if src.is_file() and not (dst / f).is_file():
            shutil.copy(src, dst / f)
    from gliner import GLiNER

    model = GLiNER.from_pretrained(str(dst), local_files_only=True)
    model.eval()
    label_map = {
        "employer": "EXACT_EMPLOYER", "job title": "RARE_ROLE",
        "location": "PRECISE_LOCATION", "team size": "SMALL_TEAM",
    }
    per_cat: dict[str, dict[str, int]] = {}
    for record in records:
        utts = record["transcript"]["utterances"]
        joined = "\n".join(u["text"] for u in utts)
        spans = model.predict_entities(joined, labels=LABELS, threshold=0.4)
        detected = {label_map.get(s["label"], s["label"].upper()) for s in spans}
        for gold in record["gold_spans"]:
            cat = gold["label"].split(".", 1)[1]
            if cat not in {"RARE_ROLE", "EXACT_EMPLOYER", "PRECISE_LOCATION",
                           "SMALL_TEAM"}:
                continue
            m = per_cat.setdefault(cat, {"found": 0, "total": 0})
            m["total"] += 1
            if cat in detected:
                m["found"] += 1
    return per_cat


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="German eval")
    parser.add_argument("--output", default=None)
    args = parser.parse_args(argv)

    records = [json.loads(l) for l in FIXTURES.read_text().splitlines() if l.strip()]
    presidio = eval_presidio_de(records)
    gliner = eval_gliner_multi(records)
    per_category = {}
    for cat, m in {**presidio, **gliner}.items():
        per_category[cat] = {
            "recall": round(m["found"] / m["total"], 4) if m["total"] else None,
            "found": m["found"], "total": m["total"],
        }
    mandatory = ["PERSON", "EMAIL", "RARE_ROLE", "EXACT_EMPLOYER",
                "PRECISE_LOCATION"]
    recalls = [per_category.get(c, {}).get("recall") for c in mandatory]
    all_ok = all(r is not None and r == 1.0 for r in recalls)
    gate = "german_added_to_supported" if all_ok else "gate_retained_evaluation_only"
    report = {
        "schema_version": "1.0",
        "language": "de",
        "fixtures": len(records),
        "models": {
            "presidio": "Presidio AnalyzerEngine + spaCy de_core_news_sm",
            "context": "urchade/gliner_multi-v2.1 (setup-time download; not pinned in the runtime manifest)",
        },
        "per_category": per_category,
        "english_bar": "mandatory-category recall == 1.0 (English gold-fixture bar for the direct+quasi mandatory categories)",
        "gate_decision": gate,
        "caveat": (
            "Synthetic fictional fixtures only (generator templates); these "
            "P/R numbers are PoC-level, not representative of real German "
            "coaching data. German stays OUT of SUPPORTED_LANGUAGES unless "
            "the gate above passes."
        ),
        "commands": "python scripts/eval_german.py",
    }
    out = pathlib.Path(args.output) if args.output else (
        PROJECT / "docs" / "evidence" / "I11-S2" / "german_eval.json"
    )
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(per_category, indent=2))
    print("gate:", gate)
    print(f"report written: {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
