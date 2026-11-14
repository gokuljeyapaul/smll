#!/usr/bin/env python3
"""Consistency lint for docs/BUILD_PLAN.md (stdlib only, Python >= 3.9).

Checks: required sections exist; use-case / acceptance IDs are unique and
contiguous; every use case is covered by an acceptance ID and by the
testability map; every acceptance ID is delivered by at least one slice; slices
only reference known IDs and contain RED / GREEN / Evidence parts.

Exit 0 = plan is consistent, 1 = problems found (printed one per line).
"""
from __future__ import annotations

import pathlib
import re
import sys

REQUIRED_SECTIONS = [
    "Purpose and honesty statement",
    "Owner decisions and defaults",
    "Use cases",
    "Architecture",
    "Fixtures and metrics",
    "Acceptance criteria",
    "Testability map",
    "LLM safety design",
    "Privacy and no-storage design",
    "Slices",
    "Toolchain and preflight",
    "CI and evidence strategy",
    "Autonomy and merge policy",
    "Risks",
]
PLATFORMS = {"web", "chromium", "webkit", "host", "device"}
PRIORITIES = {"P0", "P1"}


def split_sections(text):
    """Return {heading: body} for '## ' headings."""
    sections = {}
    current = None
    buf = []
    for line in text.splitlines():
        if line.startswith("## "):
            if current is not None:
                sections[current] = "\n".join(buf)
            current = line[3:].strip()
            buf = []
        elif current is not None:
            buf.append(line)
    if current is not None:
        sections[current] = "\n".join(buf)
    return sections


def table_rows(body, id_prefix):
    rows = []
    for line in body.splitlines():
        if line.startswith("|"):
            cells = [c.strip() for c in line.strip().strip("|").split("|")]
            if cells and re.fullmatch(id_prefix + r"\d{2}", cells[0]):
                rows.append(cells)
    return rows


def contiguous(ids, prefix):
    nums = sorted(int(i[len(prefix):]) for i in ids)
    return nums == list(range(1, len(nums) + 1))


def lint(text):
    problems = []
    sections = split_sections(text)

    for needed in REQUIRED_SECTIONS:
        if not any(needed.lower() in h.lower() for h in sections):
            problems.append("missing section: " + needed)

    def section(name):
        for h, body in sections.items():
            if name.lower() in h.lower():
                return body
        return ""

    uc_rows = table_rows(section("Use cases"), "UC")
    uc_ids = [r[0] for r in uc_rows]
    if len(set(uc_ids)) != len(uc_ids):
        problems.append("duplicate use case IDs")
    if uc_ids and not contiguous(uc_ids, "UC"):
        problems.append("use case IDs are not contiguous from UC01")
    if not uc_ids:
        problems.append("no use cases found")

    a_rows = table_rows(section("Acceptance criteria"), "A")
    a_ids = [r[0] for r in a_rows]
    if len(set(a_ids)) != len(a_ids):
        problems.append("duplicate acceptance IDs")
    if a_ids and not contiguous(a_ids, "A"):
        problems.append("acceptance IDs are not contiguous from A01")
    if not a_ids:
        problems.append("no acceptance criteria found")

    covered_uc = set()
    for r in a_rows:
        if len(r) < 6:
            problems.append("%s: acceptance row needs 6 columns" % r[0])
            continue
        _id, pri, plat, uc = r[0], r[1], r[2], r[3]
        if pri not in PRIORITIES:
            problems.append("%s: bad priority %r" % (_id, pri))
        if plat not in PLATFORMS:
            problems.append("%s: bad platform %r" % (_id, plat))
        for u in re.findall(r"UC\d{2}", uc):
            if u not in uc_ids:
                problems.append("%s references unknown %s" % (_id, u))
            covered_uc.add(u)
        if uc.strip() not in ("-",) and not re.findall(r"UC\d{2}", uc):
            problems.append("%s: UC column must be '-' or UC ids" % _id)
    for u in uc_ids:
        if u not in covered_uc:
            problems.append("%s is not covered by any acceptance ID" % u)

    t_rows = table_rows(section("Testability map"), "UC")
    t_ids = [r[0] for r in t_rows]
    for u in uc_ids:
        if u not in t_ids:
            problems.append("%s missing from the testability map" % u)
    for t in t_ids:
        if t not in uc_ids:
            problems.append("testability map references unknown %s" % t)

    slices_body = section("Slices")
    slice_blocks = re.split(r"(?m)^### ", slices_body)[1:]
    delivered = set()
    if not slice_blocks:
        problems.append("no slices found")
    names = []
    for block in slice_blocks:
        title = block.splitlines()[0].strip()
        m = re.match(r"([SD]\d+)\b", title)
        if not m:
            problems.append("slice heading must start with S<number> or D<number>: %r" % title)
            continue
        sid = m.group(1)
        names.append(sid)
        ids_line = re.search(r"\*\*Acceptance IDs:\*\*\s*(.+)", block)
        if not ids_line:
            problems.append("%s: missing **Acceptance IDs:** line" % sid)
        else:
            ids = re.findall(r"A\d{2}", ids_line.group(1))
            if not ids:
                problems.append("%s: no acceptance IDs listed" % sid)
            for i in ids:
                if i not in a_ids:
                    problems.append("%s references unknown %s" % (sid, i))
                delivered.add(i)
        for marker in ("**RED**", "**GREEN**", "**Evidence**"):
            if marker not in block:
                problems.append("%s: missing %s part" % (sid, marker))
    if len(set(names)) != len(names):
        problems.append("duplicate slice IDs")
    for i in a_ids:
        if i not in delivered:
            problems.append("%s is not delivered by any slice" % i)

    return problems


def main(argv):
    path = pathlib.Path(argv[1]) if len(argv) > 1 else (
        pathlib.Path(__file__).resolve().parents[1] / "docs" / "BUILD_PLAN.md")
    if not path.is_file():
        print("plan_lint: FAIL missing %s" % path)
        return 1
    problems = lint(path.read_text(encoding="utf-8"))
    if problems:
        print("plan_lint: FAIL")
        for p in problems:
            print("  - " + p)
        return 1
    text = path.read_text(encoding="utf-8")
    n_a = len(re.findall(r"(?m)^\| A\d{2} \|", text))
    n_uc = len(re.findall(r"(?m)^\| UC\d{2} \| [^|]+\| [^|]+\|$", text))
    print("plan_lint: OK (%d acceptance IDs, use cases checked, plan is internally consistent)" % n_a)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
