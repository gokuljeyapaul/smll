#!/usr/bin/env python3
"""Plan lint for this project's docs/BUILD_PLAN.md (stdlib only, Python >= 3.9).

Checks that the plan is internally consistent so the building agent and
tools/gen_issues.py can trust it:
  - required sections exist
  - use-case IDs (UC..) are unique; acceptance rows reference known UCs or '-'
  - acceptance IDs (A..) are unique and each is owned by exactly one slice
  - every slice has an '**Acceptance IDs:**' line and an 'Observable result:' line
  - owner-visual rows (O..) reference known slices and known UCs
  - model candidates table exists and every candidate row names a license-check column
  - milestone-status.json phase is a known value and PLAN_ONLY claims no PASS

  python3 scripts/plan_lint.py            # lint, exit 0 on success
  python3 scripts/plan_lint.py --self-test
"""
from __future__ import annotations

import json
import pathlib
import re
import sys

PROJECT_DIR = pathlib.Path(__file__).resolve().parents[1]
PLAN = PROJECT_DIR / "docs" / "BUILD_PLAN.md"
MILESTONE = PROJECT_DIR / "milestone-status.json"
REQUIRED = [
    "Purpose and honesty statement",
    "Owner decisions and defaults",
    "Use cases",
    "Architecture",
    "The SLM showcase",
    "Fixtures and metrics",
    "Acceptance criteria",
    "Conformance",
    "Slices",
    "Toolchain and preflight",
    "CI and evidence strategy",
    "Autonomy and merge policy",
    "Risks",
]
PHASES = {"PLAN_ONLY", "BUILDING", "COMPLETE"}


def sections(text: str) -> dict[str, str]:
    out, cur, buf = {}, None, []
    for line in text.splitlines():
        if line.startswith("## "):
            if cur is not None:
                out[cur] = "\n".join(buf)
            cur, buf = line[3:].strip(), []
        elif cur is not None:
            buf.append(line)
    if cur is not None:
        out[cur] = "\n".join(buf)
    return out


def rows(body: str, prefix: str) -> list[list[str]]:
    res = []
    for line in body.splitlines():
        if line.startswith("|"):
            cells = [c.strip() for c in line.strip().strip("|").split("|")]
            if cells and re.fullmatch(prefix + r"\d{2}", cells[0]):
                res.append(cells)
    return res


def lint(text: str, milestone: dict | None = None) -> list[str]:
    errs: list[str] = []
    sec = sections(text)
    for name in REQUIRED:
        if name not in sec:
            errs.append(f"missing section: ## {name}")
    ucs = [r[0] for r in rows(sec.get("Use cases", ""), "UC")]
    if len(ucs) != len(set(ucs)):
        errs.append("duplicate UC IDs")
    if not ucs:
        errs.append("no use cases")
    acc = rows(sec.get("Acceptance criteria", ""), "A")
    aids = [r[0] for r in acc]
    if len(aids) != len(set(aids)):
        errs.append("duplicate acceptance IDs")
    for r in acc:
        if len(r) < 6:
            errs.append(f"{r[0]}: acceptance row needs ID|Pri|Plat|UC|Criterion|Verification")
            continue
        for uc in re.split(r"[ ,]+", r[3]):
            if uc and uc != "-" and uc not in ucs:
                errs.append(f"{r[0]}: unknown use case {uc}")
        if r[2] not in {"host", "web", "live", "device"}:
            errs.append(f"{r[0]}: unknown platform {r[2]}")
    owned: dict[str, str] = {}
    slice_ids = []
    for block in re.split(r"(?m)^### ", sec.get("Slices", ""))[1:]:
        title = block.splitlines()[0]
        m = re.match(r"(S\d+)\s*[—–-]+\s*(.+)", title)
        if not m:
            continue
        sid = m.group(1)
        slice_ids.append(sid)
        ids_line = re.search(r"\*\*Acceptance IDs:\*\*\s*(.+)", block)
        if not ids_line:
            errs.append(f"{sid}: missing **Acceptance IDs:** line")
            continue
        if not re.search(r"Observable result:\s*\S", block):
            errs.append(f"{sid}: missing Observable result")
        for a in re.findall(r"A\d{2}", ids_line.group(1)):
            if a not in aids:
                errs.append(f"{sid}: acceptance ID {a} not in the table")
            if a in owned:
                errs.append(f"{a}: owned by both {owned[a]} and {sid}")
            owned[a] = sid
    if not slice_ids:
        errs.append("no slices")
    for a in aids:
        if a not in owned:
            errs.append(f"{a}: not owned by any slice")
    for r in rows(sec.get("Conformance", ""), "O"):
        if len(r) < 5:
            errs.append(f"{r[0]}: owner-visual row needs ID|Slice|Refs|Artifact|Owner confirms")
            continue
        if r[1] not in slice_ids:
            errs.append(f"{r[0]}: unknown slice {r[1]}")
        for uc in re.split(r"[ ,]+", r[2]):
            if uc.startswith("UC") and uc not in ucs:
                errs.append(f"{r[0]}: unknown use case {uc}")
    show = sec.get("The SLM showcase", "")
    if "| Candidate" not in show or "License" not in show:
        errs.append("SLM showcase needs a candidate table with a License column")
    if milestone is not None:
        phase = milestone.get("phase")
        if phase not in PHASES:
            errs.append(f"milestone-status.json: unknown phase {phase}")
        if phase == "PLAN_ONLY" and "PASS" in json.dumps(milestone.get("acceptance", {})):
            errs.append("milestone-status.json: PLAN_ONLY may not claim PASS")
    return errs


GOOD = """# p
## Purpose and honesty statement
x
## Owner decisions and defaults
x
## Use cases
| ID | Title | Description |
|---|---|---|
| UC01 | a | b |
## Architecture
x
## The SLM showcase
| Candidate | Role | License (verify at build) |
|---|---|---|
| m | r | l |
## Fixtures and metrics
x
## Acceptance criteria
| ID | Pri | Plat | UC | Criterion | Verification |
|---|---|---|---|---|---|
| A01 | P0 | host | UC01 | c | v |
## Conformance
| ID | Slice | Refs | Artifact | The owner confirms |
|---|---|---|---|---|
| O01 | S0 | UC01 | a | b |
## Slices
### S0 — First
**Acceptance IDs:** A01
Observable result: it works.
## Toolchain and preflight
x
## CI and evidence strategy
x
## Autonomy and merge policy
x
## Risks
x
"""


def self_test() -> int:
    assert lint(GOOD, {"phase": "PLAN_ONLY"}) == [], lint(GOOD)
    bad = GOOD.replace("**Acceptance IDs:** A01", "**Acceptance IDs:** A02")
    e = lint(bad)
    assert any("A02" in x for x in e) and any("A01: not owned" in x for x in e), e
    assert any("unknown use case UC09" in x for x in lint(GOOD.replace("| A01 | P0 | host | UC01", "| A01 | P0 | host | UC09")))
    assert any("unknown platform" in x for x in lint(GOOD.replace("| P0 | host |", "| P0 | cloud |")))
    assert any("Observable" in x for x in lint(GOOD.replace("Observable result: it works.", "")))
    assert any("O01: unknown slice" in x for x in lint(GOOD.replace("| O01 | S0 |", "| O01 | S9 |")))
    assert any("may not claim PASS" in x for x in lint(GOOD, {"phase": "PLAN_ONLY", "acceptance": {"A01": "PASS"}}))
    assert any("missing section: ## Risks" in x for x in lint(GOOD.replace("## Risks", "## Riskz")))
    print("plan_lint self-test: 8 checks passed")
    return 0


def main(argv: list[str]) -> int:
    if "--self-test" in argv:
        return self_test()
    milestone = json.loads(MILESTONE.read_text()) if MILESTONE.exists() else None
    errs = lint(PLAN.read_text(encoding="utf-8"), milestone)
    for e in errs:
        print(f"PLAN_LINT FAIL: {e}")
    if errs:
        return 1
    text = PLAN.read_text(encoding="utf-8")
    sec = sections(text)
    print(
        "plan_lint OK: %d use cases, %d acceptance IDs, %d slices, %d owner-visual items"
        % (
            len(rows(sec["Use cases"], "UC")),
            len(rows(sec["Acceptance criteria"], "A")),
            len(re.findall(r"(?m)^### S\d+", sec["Slices"])),
            len(rows(sec["Conformance"], "O")),
        )
    )
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
