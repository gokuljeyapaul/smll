#!/usr/bin/env python3
"""Evidence integrity verifier (stdlib only, Python >= 3.9) — folderchat.

For every docs/evidence/<slice>/summary.json:
  * every acceptance ID is known to docs/BUILD_PLAN.md and has a valid status
    (PASS | PARTIAL | NOT_RUN | BLOCKED);
  * PASS requires >= 1 test reference "junit:<path>::<testcase name>" that resolves to
    a testcase in a committed JUnit XML with no failure / error / skipped child, and
    for the plan's web-platform IDs a reference whose path contains the platform token;
  * the CURRENT slice's summary.json source_digest must equal the digest recomputed
    from the working tree (evidence produced from different code is stale). Earlier
    slices' summaries are historical. The current slice is milestone-status.json
    current_slice, else the newest slice with a summary;
  * PLAN_ONLY phase: no PASS may be claimed anywhere.

Usage: verify_evidence.py [--root DIR] [--print-digest]   (exit 0 = OK)
"""
from __future__ import annotations

import hashlib
import json
import pathlib
import re
import sys
import xml.etree.ElementTree as ET

STATUSES = {"PASS", "PARTIAL", "NOT_RUN", "BLOCKED"}
# everything the committed evidence depends on
DIGEST_PATHS = ["src", "tests", "fixtures", "config", "scripts/model_manifest.json",
                "pyproject.toml", "requirements.txt"]


def plan_ids(root: pathlib.Path) -> dict[str, str]:
    text = (root / "docs" / "BUILD_PLAN.md").read_text(encoding="utf-8")
    ids: dict[str, str] = {}
    for m in re.finditer(r"(?m)^\|\s*(A\d{2})\s*\|\s*P[01]\s*\|\s*(\w+)\s*\|", text):
        ids[m.group(1)] = m.group(2)
    return ids


def source_digest(root: pathlib.Path) -> str:
    h = hashlib.sha256()
    files = []
    for rel in DIGEST_PATHS:
        p = root / rel
        if p.is_file():
            files.append(p)
        elif p.is_dir():
            for f in sorted(p.rglob("*")):
                if f.is_file() and "node_modules" not in f.parts and "__pycache__" not in f.parts:
                    files.append(f)
    for f in sorted(set(files)):
        h.update(str(f.relative_to(root)).encode("utf-8") + b"\0")
        h.update(hashlib.sha256(f.read_bytes()).hexdigest().encode("ascii") + b"\n")
    return h.hexdigest()


def junit_testcase_passed(root: pathlib.Path, ref: str) -> tuple[bool, str]:
    m = re.fullmatch(r"junit:(.+?)::(.+)", ref)
    if not m:
        return False, f"malformed test reference {ref!r}"
    rel, name = m.group(1), m.group(2)
    path = root / rel
    if not path.is_file():
        return False, f"missing JUnit file {rel}"
    try:
        tree = ET.parse(str(path))
    except ET.ParseError as exc:
        return False, f"unparseable JUnit {rel}: {exc}"
    found = False
    for tc in tree.iter("testcase"):
        if tc.get("name") == name or (tc.get("name") or "").endswith("[" + name + "]"):
            found = True
            for bad in ("failure", "error", "skipped"):
                if tc.find(bad) is not None:
                    return False, f"testcase {name!r} in {rel} has <{bad}>"
    if not found:
        return False, f"testcase {name!r} not found in {rel}"
    return True, ""


def slice_num(name: str | None) -> int:
    m = re.fullmatch(r"S(\d+)", name or "")
    return int(m.group(1)) if m else -1


def verify(root: pathlib.Path) -> list[str]:
    problems: list[str] = []
    status_file = root / "milestone-status.json"
    if not status_file.is_file():
        return ["missing milestone-status.json"]
    milestone = json.loads(status_file.read_text(encoding="utf-8"))
    phase = milestone.get("phase", "PLAN_ONLY")
    ids = plan_ids(root)

    if phase == "PLAN_ONLY":
        st = (root / "docs" / "status.md")
        if st.is_file() and re.search(r"\| *PASS *\|", st.read_text(encoding="utf-8")):
            problems.append("status.md claims PASS in PLAN_ONLY")
        return problems

    summaries: dict[str, pathlib.Path] = {}
    ev_dir = root / "docs" / "evidence"
    if ev_dir.is_dir():
        for d in sorted(ev_dir.iterdir()):
            s = d / "summary.json"
            if d.is_dir() and s.is_file():
                summaries[d.name] = s

    current = milestone.get("current_slice")
    if current is None or current not in summaries:
        current = max(summaries, key=slice_num) if summaries else None

    for name, path in summaries.items():
        try:
            summary = json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as exc:
            problems.append(f"{name}: unparseable summary.json: {exc}")
            continue
        acc = summary.get("acceptance", {})
        for aid, entry in acc.items():
            if aid not in ids:
                problems.append(f"{name}: unknown acceptance ID {aid}")
                continue
            status = entry.get("status")
            if status not in STATUSES:
                problems.append(f"{name}: {aid} invalid status {status!r}")
                continue
            if status != "PASS":
                continue
            refs = entry.get("tests") or []
            if not refs:
                problems.append(f"{name}: {aid} PASS with no test references")
                continue
            platform = ids[aid]
            ok_refs = 0
            for ref in refs:
                ok, reason = junit_testcase_passed(root, ref)
                if not ok:
                    problems.append(f"{name}: {aid} bad ref {ref}: {reason}")
                elif platform == "web" and "chromium" not in ref.lower():
                    problems.append(f"{name}: {aid} web-platform PASS needs a chromium junit ref: {ref}")
                else:
                    ok_refs += 1
            if ok_refs == 0:
                problems.append(f"{name}: {aid} PASS has no resolving test reference")

    # slices recorded as MERGED must have a summary
    for name, entry in (milestone.get("slices") or {}).items():
        if isinstance(entry, dict) and entry.get("status") in ("READY_FOR_MERGE", "MERGED") and name not in summaries:
            problems.append(f"{name}: recorded {entry['status']} but no summary.json exists")

    if current and current in summaries:
        summary = json.loads(summaries[current].read_text(encoding="utf-8"))
        declared = summary.get("source_digest")
        actual = source_digest(root)
        if declared != actual:
            problems.append(
                f"{current}: source_digest mismatch — summary says {declared}, tree is {actual} "
                "(evidence was produced from different code)")
    return problems


def main(argv: list[str] | None = None) -> int:
    import argparse

    ap = argparse.ArgumentParser()
    ap.add_argument("--root", default=str(pathlib.Path(__file__).resolve().parents[1]))
    ap.add_argument("--print-digest", action="store_true")
    args = ap.parse_args(argv)
    root = pathlib.Path(args.root)
    if args.print_digest:
        print(source_digest(root))
        return 0
    problems = verify(root)
    for p in problems:
        print("PROBLEM:", p)
    if problems:
        print(f"verify_evidence: {len(problems)} problem(s)")
        return 1
    print("verify_evidence: OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
