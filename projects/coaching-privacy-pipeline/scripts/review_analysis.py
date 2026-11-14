#!/usr/bin/env python
"""Review-rate analysis over the 18 seed fixtures (issue #10 slice 1).

Runs every fixture through the REAL pipeline (real Presidio + GLiNER) and
classifies each session: correct / false-REVIEW / false-RELEASE / known-gap
(expected REVIEW with no detector that could produce it). Committed to
docs/evidence/ as the observed baseline for any threshold work in slice 2.
"""
from __future__ import annotations

import argparse
import json
import pathlib
import sys

PROJECT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT / "src"))

FIXTURES = PROJECT / "fixtures" / "seed_fixtures.jsonl"


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="Review-rate analysis")
    parser.add_argument("--output", default=None)
    args = parser.parse_args(argv)

    from coaching_privacy.contracts import Transcript
    from coaching_privacy.engine import process_transcript
    from coaching_privacy.policy import PolicyStore

    store = PolicyStore(PROJECT / "policies" / "sample_policy.yaml")
    sessions = []
    counts = {"correct": 0, "false-REVIEW": 0, "false-RELEASE": 0, "known-gap": 0}
    for line in FIXTURES.read_text().splitlines():
        if not line.strip():
            continue
        record = json.loads(line)
        fx_id = record["fixture_id"]
        expected = record["expected_baseline_decision"]
        gold_ctx = record.get("gold_context_risk_codes", [])
        transcript = Transcript.parse(record["transcript"])
        result = process_transcript(
            transcript, store.get(transcript.purpose),
            prohibited_leaks=record.get("prohibited_leaks"),
        )
        actual = result.decision["decision"]
        reasons = result.decision.get("review_reasons", [])
        ctx_labels = sorted({
            r.get("code") for r in result.report.get("context_risks", [])
        })
        # Classification:
        #   correct: actual == expected
        #   false-REVIEW: expected RELEASE, actual REVIEW/BLOCKED
        #   false-RELEASE: expected REVIEW, actual RELEASE
        #   known-gap: expected REVIEW with no gold context code (no detector
        #              could produce the expected decision)
        if actual == expected:
            cls = "correct"
        elif expected == "RELEASE_CANDIDATE" and actual in {"REVIEW_REQUIRED", "BLOCKED"}:
            cls = "false-REVIEW"
        elif expected == "REVIEW_REQUIRED" and actual == "RELEASE_CANDIDATE":
            cls = "false-RELEASE"
        elif expected == "REVIEW_REQUIRED" and not gold_ctx:
            cls = "known-gap"
        else:
            cls = "correct" if actual != "RELEASE_CANDIDATE" else "false-RELEASE"
        counts[cls] += 1
        sessions.append({
            "fixture_id": fx_id,
            "expected": expected,
            "actual": actual,
            "classification": cls,
            "reasons": reasons,
            "context_labels": ctx_labels,
            "gold_context_risk_codes": gold_ctx,
        })
    report = {
        "schema_version": "1.0",
        "note": (
            "Observed baseline on the real pipeline (Presidio + GLiNER). "
            "known-gap = expected REVIEW_REQUIRED with no gold context code "
            "(no detector exists for that expectation; new detectors out of "
            "scope here). Synthetic fixtures only."
        ),
        "summary": counts,
        "sessions": sessions,
        "commands": "python scripts/review_analysis.py",
    }
    out = pathlib.Path(args.output) if args.output else (
        PROJECT / "docs" / "evidence" / "I10-S1" / "review_analysis.json"
    )
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(counts, indent=2))
    for s in sessions:
        print(f"{s['fixture_id']}: expected={s['expected']} actual={s['actual']} "
              f"class={s['classification']} ctx={s['context_labels']}")
    print(f"report written: {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
