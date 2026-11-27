#!/usr/bin/env python3
"""Apply the plan's ship rule to the recorded candidate numbers and write
docs/evidence/S0/eval/ship_rule.json.

Ship rule (BUILD_PLAN 'Selection'): the SLM ships as the default answer mode only if
citation precision >= 0.95 AND abstention F1 >= 0.80 AND answer F1 beats the BM25
baseline by >= 10 pp; otherwise the app ships in 'find passages' mode by default and
the numbers are published. Eligibility is restricted to candidates within the D1
shipped-size limit (granite-4.0-micro is host-bench-only and can never ship)."""
from __future__ import annotations

import json
import pathlib
import sys

EVAL = pathlib.Path(__file__).resolve().parents[1] / "docs" / "evidence" / "S0" / "eval"
CANDIDATES = ["pleias-rag-1b", "pleias-rag-350m", "occ-rag-1.7b", "granite-4.0-micro", "bm25-top-passage"]
# D1: shipped default answer model <= 2B parameters
SHIP_ELIGIBLE = {"pleias-rag-1b", "pleias-rag-350m", "occ-rag-1.7b"}
METRIC_KEYS = ("answer_f1", "citation_precision", "citation_recall", "abstention_f1",
              "abstention_precision", "abstention_recall", "exact_match",
              "gold_source_cited_rate", "injection_leak_rate")


def main() -> int:
    per = {}
    for c in CANDIDATES:
        path = EVAL / f"answers_{c}.json"
        if not path.is_file():
            print(f"gen_ship_rule: missing {path.name}", file=sys.stderr)
            return 1
        per[c] = json.loads(path.read_text(encoding="utf-8"))
    baseline_f1 = float(per["bm25-top-passage"]["answer_f1"])

    eligible_winners = []
    for c, m in per.items():
        if c not in SHIP_ELIGIBLE:
            continue
        passes = (float(m["citation_precision"]) >= 0.95
                  and float(m["abstention_f1"]) >= 0.80
                  and float(m["answer_f1"]) >= baseline_f1 + 0.10)
        print(f"{c}: f1={m['answer_f1']:.3f} cite_prec={m['citation_precision']:.3f} "
              f"abstain_f1={m['abstention_f1']:.3f} baseline+10pp={baseline_f1 + 0.10:.3f} "
              f"-> {'ELIGIBLE' if passes else 'not eligible'}")
        if passes:
            eligible_winners.append((c, float(m["answer_f1"])))

    if eligible_winners:
        winner = max(eligible_winners, key=lambda t: t[1])[0]
        verdict = {
            "default_mode": "slm",
            "default_answer_candidate": winner,
            "rule": "citation precision >= 0.95 AND abstention F1 >= 0.80 AND answer F1 >= baseline + 10pp",
            "reasoning": (
                f"{winner} beats the BM25 baseline (F1 {baseline_f1:.3f}) by "
                f"{float(per[winner]['answer_f1']) - baseline_f1:.3f} pp with citation precision "
                f"{per[winner]['citation_precision']:.3f} and abstention F1 "
                f"{per[winner]['abstention_f1']:.3f}; all three ship-rule bars met"),
            "per_candidate": {c: {k: m[k] for k in METRIC_KEYS} for c, m in per.items()},
            "baseline_answer_f1": baseline_f1,
            "ineligible": [c for c in ("granite-4.0-micro",) ],
            "ineligible_reason": "granite-4.0-micro is ~3B: above the D1 shipped-default limit; host bench only",
        }
    else:
        verdict = {
            "default_mode": "passages",
            "default_answer_candidate": None,
            "rule": "citation precision >= 0.95 AND abstention F1 >= 0.80 AND answer F1 >= baseline + 10pp",
            "reasoning": ("no candidate beat the baseline by the plan's margin with the required citation "
                          "precision and abstention — the BM25 top-passage baseline ships as the default "
                          "answer mode ('find passages') and these numbers are published"),
            "per_candidate": {c: {k: m[k] for k in METRIC_KEYS} for c, m in per.items()},
            "baseline_answer_f1": baseline_f1,
            "ineligible": ["granite-4.0-micro"],
            "ineligible_reason": "granite-4.0-micro is ~3B: above the D1 shipped-default limit; host bench only",
        }
    out = EVAL / "ship_rule.json"
    out.write_text(json.dumps(verdict, indent=2) + "\n")
    print(f"ship rule verdict: default_mode={verdict['default_mode']} "
          f"default={verdict.get('default_answer_candidate')} -> {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
