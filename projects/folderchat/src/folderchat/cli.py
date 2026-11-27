"""The folderchat command line: add / ask / doctor (S0 surface)."""
from __future__ import annotations

import argparse
import hashlib
import sys
from typing import Any

VERSION = "0.1.0"


def _build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="folderchat",
        description="Ask a local folder, get cited answers (or an honest 'not found').")
    p.add_argument("--version", action="version", version=f"folderchat {VERSION}")
    sub = p.add_subparsers(dest="cmd")

    add = sub.add_parser("add", help="index a folder (supported: PDF, DOCX, Markdown, TXT, HTML)")
    add.add_argument("folder", help="path to the folder to index")

    ask = sub.add_parser("ask", help="ask a question of everything indexed so far")
    ask.add_argument("question")
    ask.add_argument("--mode", choices=["auto", "slm", "passages"], default="auto",
                     help="answer mode: auto (the measured default), slm, or passages (BM25)")

    sub.add_parser("doctor", help="verify the installation: models, data dir, index")
    return p


def _doctor() -> int:
    """Offline self-check. Never touches the network: verifies the pinned model files
    byte-for-byte (sha256) and the data dir's writability."""
    from folderchat.config import data_dir, load_manifest, models_dir

    problems: list[str] = []
    manifest = load_manifest()
    mdir = models_dir()
    print("folderchat doctor")
    print(f"  python: {sys.version.split()[0]}")
    verified_count = 0
    for role, entry in manifest.get("roles", {}).items():
        if entry.get("url") is None and entry.get("files") is None:
            print(f"  [{role}] no download needed (mode/baseline)")
            continue
        if "files" in entry:
            base = mdir / entry["repo"].split("/")[-1]
            role_ok = True
            for f in entry["files"]:
                p = base / f["path"]
                if not p.is_file():
                    problems.append(f"{role}: missing {f['path']}")
                    role_ok = False
                    continue
                if p.stat().st_size != int(f["size_bytes"]) or _sha(p) != f["sha256"]:
                    problems.append(f"{role}: {f['path']} failed sha256/size verification")
                    role_ok = False
            if role_ok:
                verified_count += 1
                print(f"  [{role}] {entry['repo']} @ {entry.get('revision', '?')[:12]} — verified "
                      f"({len(entry['files'])} files, sha256+size)")
        elif entry.get("url"):
            p = mdir / entry["file"]
            if not p.is_file():
                problems.append(f"{role}: missing model file {entry['file']}")
            elif p.stat().st_size != int(entry["size_bytes"]) or _sha(p) != entry["sha256"]:
                problems.append(f"{role}: {entry['file']} failed sha256/size verification")
            else:
                verified_count += 1
                print(f"  [{role}] {entry['repo']} @ {entry.get('revision', '?')[:12]} — verified "
                      f"({entry['license']}, {int(entry['size_bytes']) / 1e6:.0f} MB)")
        patch = entry.get("patch")
        if patch:
            pp = mdir / patch["output_file"]
            if not pp.is_file():
                problems.append(f"{role}: missing patched artifact {patch['output_file']}")
            elif _sha(pp) != patch["sha256"] or pp.stat().st_size != int(patch["size_bytes"]):
                problems.append(f"{role}: patched artifact {patch['output_file']} failed verification")
            else:
                print(f"  [{role}] patched artifact {patch['output_file']} — verified "
                      f"({patch['op']}; see scripts/model_manifest.json)")
    print(f"  pinned models: {verified_count} role(s) verified")
    try:
        d = data_dir()
        probe = d / ".doctor-probe"
        probe.write_text("ok")
        probe.unlink()
        print(f"  data dir: {d} — writable")
    except Exception as e:  # noqa: BLE001
        problems.append(f"data dir not writable: {e}")
    default_mode = manifest.get("default_mode", "slm")
    suffix = "" if default_mode == "slm" else \
        " (the SLM lost the measured fight to the BM25 baseline; numbers in docs/evidence/)"
    print(f"  default answer mode: {default_mode}{suffix}")
    if problems:
        for p_ in problems:
            print(f"  PROBLEM: {p_}")
        print("doctor: FAIL")
        return 1
    print("doctor: OK")
    return 0


def _sha(path: Any) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        while True:
            block = f.read(1 << 20)
            if not block:
                break
            h.update(block)
    return h.hexdigest()


def _ask(question: str, mode: str) -> int:
    from folderchat.baseline import passages_answer
    from folderchat.config import data_dir, load_limits, load_manifest
    from folderchat.retrieve import retrieve

    limits = load_limits()
    if len(question) > limits.max_question_chars:
        print(f"Question too long: {len(question)} > {limits.max_question_chars} characters.", file=sys.stderr)
        return 2
    manifest = load_manifest()
    effective = mode
    if mode == "auto":
        effective = manifest.get("default_mode", "slm")
    hits = retrieve(question, k=limits.retrieve_top_k, mode="hybrid", data_dir=data_dir())
    if not hits:
        print("No sources have been indexed yet. Run: folderchat add <folder>")
        return 1

    if effective == "slm":
        entry = manifest["roles"].get("answer")
        if entry is None or entry.get("url") is None:
            effective = "passages"
        else:
            from folderchat.answer import AnswerEngine
            from folderchat.config import resolve_model_path

            engine = AnswerEngine(manifest, resolve_model_path(entry),
                                  timeout_s=limits.answer_timeout_s, max_tokens=limits.answer_max_tokens,
                                  reserved_answer_tokens=limits.reserved_answer_tokens)
            try:
                result = engine.ask(question, hits[: limits.prompt_source_count])
            finally:
                engine.close()
            return _print_result(result, limits)

    pa = passages_answer(question, hits)
    print("Key passages:")
    for s in pa["key_sentences"]:
        print(f"  - {s}")
    print("Closest passages:")
    for i, p in enumerate(pa["passages"], 1):
        loc = _loc(p)
        print(f"  [{i}] {loc}")
        print(f"      {p['text'][:240]}")
    print("(passage mode: keyword search + best passages; no generated answer)")
    return 0


def _loc(p: dict[str, Any]) -> str:
    where = p.get("file") or "?"
    if p.get("page") is not None:
        where += f", p. {p['page']}"
    elif p.get("heading"):
        where += f" — {p['heading']}"
    return where


def _print_result(result: Any, limits: Any) -> int:
    if result.not_found:
        print("Not found in your documents.")
        if result.fallback_notice:
            print(result.fallback_notice)
        print("Closest passages:")
        for i, p in enumerate(result.closest_passages, 1):
            print(f"  [{i}] {_loc(p)}")
            print(f"      {p['text'][:240]}")
        return 0
    print(result.answer_text)
    if result.notice:
        print(f"Note: {result.notice}")
    if result.unsupported_claims:
        for c in result.unsupported_claims:
            print(f"Unsupported claim removed: {c}")
    print("Sources:")
    for c in result.citations:
        print(f"  [{c['n']}] {_loc(c)} — \"{c['quote']}\"")
    return 0


def main(argv: list[str] | None = None) -> int:
    from folderchat.config import ConfigError

    parser = _build_parser()
    args = parser.parse_args(argv)
    if args.cmd is None:
        parser.print_help()
        return 0
    try:
        if args.cmd == "doctor":
            return _doctor()
        if args.cmd == "add":
            from folderchat.config import data_dir, load_limits
            from folderchat.indexer import AddError, add_source

            try:
                report = add_source(args.folder, load_limits(), data_dir=data_dir())
            except AddError as e:
                print(f"add failed: {e}", file=sys.stderr)
                return 1
            print(report.summary())
            return 0
        if args.cmd == "ask":
            return _ask(args.question, args.mode)
    except ConfigError as e:
        print(f"configuration refused at startup: {e}", file=sys.stderr)
        return 2
    except Exception as e:  # noqa: BLE001 — the CLI fails closed with a visible reason
        print(f"error: {type(e).__name__}: {e}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
