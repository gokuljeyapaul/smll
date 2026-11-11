"""privacy-fixtures CLI: generate / directory commands (S1)."""
from __future__ import annotations

import argparse
import json
import pathlib
import sys

from .generator import GENERATOR_VERSION, generate_directory, generate_fixtures


def _write_jsonl(path: pathlib.Path, records: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w") as fh:
        for rec in records:
            fh.write(json.dumps(rec, sort_keys=True) + "\n")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="privacy-fixtures")
    sub = parser.add_subparsers(dest="command", required=True)
    gen = sub.add_parser("generate", help="Generate deterministic fictional sessions")
    gen.add_argument("--seed", type=int, required=True)
    gen.add_argument("--sessions", type=int, required=True)
    gen.add_argument("--output", required=True, help="Output .jsonl path")
    gen.add_argument("--locked", action="store_true",
                     help="Generate a locked holdout split (distinct persona namespace)")
    d = sub.add_parser("directory", help="Generate fictional candidate identity directory")
    d.add_argument("--seed", type=int, required=True)
    d.add_argument("--size", type=int, required=True)
    d.add_argument("--output", required=True, help="Output .jsonl path")
    return parser


def main(argv=None) -> int:
    args = build_parser().parse_args(argv)
    if args.command == "generate":
        seed = args.seed if not args.locked else args.seed
        records = generate_fixtures(seed, args.sessions, locked=args.locked)
        # persona namespaces for holdout must differ from dev seed 42 usage;
        # seeds define the namespace so distinct seeds stay disjoint.
        _write_jsonl(pathlib.Path(args.output), records)
        print(
            f"generated {len(records)} synthetic sessions "
            f"(seed={args.seed}, locked={args.locked}, "
            f"generator_version={GENERATOR_VERSION}) -> {args.output}"
        )
        return 0
    if args.command == "directory":
        records = generate_directory(args.seed, args.size)
        _write_jsonl(pathlib.Path(args.output), records)
        print(
            f"generated {len(records)} fictional directory entries "
            f"(seed={args.seed}) -> {args.output}"
        )
        return 0
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
