"""privacy-eval CLI: run evaluation of processed results against gold fixtures (S1)."""
from __future__ import annotations

import argparse
import pathlib
import sys


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="privacy-eval")
    sub = parser.add_subparsers(dest="command", required=True)
    run = sub.add_parser("run", help="Evaluate processed results against fixtures")
    run.add_argument("--fixtures", required=True, help="Fixture .jsonl path")
    run.add_argument("--results", required=True, help="Processed results directory")
    run.add_argument("--output", required=True, help="Report output directory")
    return parser


def main(argv=None) -> int:
    args = build_parser().parse_args(argv)
    from .evaluator import evaluate, write_reports

    fixtures_path = pathlib.Path(args.fixtures)
    results_path = pathlib.Path(args.results)
    if not fixtures_path.is_file():
        print(f"error: fixtures not found: {fixtures_path}", file=sys.stderr)
        return 2
    if not results_path.is_dir():
        print(f"error: results directory not found: {results_path}", file=sys.stderr)
        return 2
    try:
        summary = evaluate(fixtures_path, results_path)
    except (ValueError, FileNotFoundError, json_error()) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2
    write_reports(summary, pathlib.Path(args.output))
    print(
        f"evaluated {summary['sessions_evaluated']} sessions; "
        f"prohibited leaks: {summary['leaked_prohibited']}; "
        f"categories: {', '.join(summary['detection_recall'])}"
    )
    return 0


def json_error():
    import json
    return (json.JSONDecodeError,)


if __name__ == "__main__":
    raise SystemExit(main())
