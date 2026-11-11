"""Importable CLI shell for privacy-pipeline process.

S0 RED-phase skeleton: argument parsing and error handling exist, but the
processing behavior is intentionally not implemented yet.
"""
import argparse
import sys


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="privacy-pipeline")
    sub = parser.add_subparsers(dest="command", required=True)
    proc = sub.add_parser("process", help="Process transcripts through the privacy pipeline")
    proc.add_argument("--input", required=True, help="Input .jsonl or .json transcript file")
    proc.add_argument("--policy", required=True, help="Named purpose policy, e.g. internal_coaching_analysis")
    proc.add_argument("--output", required=True, help="Output directory for results")
    proc.add_argument("--policy-file", default=None, help="Policies YAML file")
    proc.add_argument("--session-id", default=None, help="Process only this session")
    return parser


def main(argv=None) -> int:
    args = build_parser().parse_args(argv)
    if args.command == "process":
        from .contracts import ContractError
        try:
            from .engine import run_pipeline
            run_pipeline(args)
        except (ContractError, FileNotFoundError, ValueError, KeyError) as exc:
            print(f"error: {exc}", file=sys.stderr)
            return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
