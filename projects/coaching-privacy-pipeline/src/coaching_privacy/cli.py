"""CLI for privacy-pipeline process (S0→S7; batch wiring per issue #21).

Supports --input-format {auto,jsonl,json,csv} (auto detects by suffix).
Batch modes go through the S7 adapters and are all-or-nothing: the whole
batch is materialised and validated first; results are staged and moved
into the output dir only after every session succeeded. A malformed record
exits 2 with no partial outputs.
"""
import argparse
import sys


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="privacy-pipeline")
    sub = parser.add_subparsers(dest="command", required=True)
    proc = sub.add_parser("process", help="Process transcripts through the privacy pipeline")
    proc.add_argument("--input", required=True, help="Input .jsonl, .json (array) or .csv transcript file")
    proc.add_argument("--input-format", choices=["auto", "jsonl", "json", "csv"],
                      default="auto", help="Input format (auto detects by suffix)")
    proc.add_argument("--policy", required=True, help="Named purpose policy, e.g. internal_coaching_analysis")
    proc.add_argument("--output", required=True, help="Output directory for results")
    proc.add_argument("--policy-file", default=None, help="Policies YAML file")
    proc.add_argument("--session-id", default=None, help="Process only this session")
    proc.add_argument("--csv-column-map", default=None,
                      help="CSV column-mapping JSON file (csv input only; issue #12)")
    proc.add_argument("--link-group-key", default=None,
                      help="Metadata key grouping sessions for cross-session linkage (issue #23)")
    return parser


def main(argv=None) -> int:
    args = build_parser().parse_args(argv)
    if args.command == "process":
        from .batch import BatchError
        from .contracts import ContractError
        try:
            from .engine import run_pipeline
            run_pipeline(args)
        except (ContractError, BatchError, FileNotFoundError, ValueError, KeyError) as exc:
            print(f"error: {exc}", file=sys.stderr)
            return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
