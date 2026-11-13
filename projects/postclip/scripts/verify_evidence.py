#!/usr/bin/env python3
"""Evidence integrity verifier (stdlib only, Python >= 3.9).

Phase PLAN_ONLY: no slice has been delivered; verifies that no evidence claims
anything and that milestone-status.json is consistent with the plan.

Phase BUILDING / COMPLETE: for every docs/evidence/<slice>/summary.json:
  * every acceptance ID is known to docs/BUILD_PLAN.md and has a valid status
    (PASS | PARTIAL | NOT_RUN | BLOCKED);
  * PASS requires >= 1 test reference "junit:<path>::<testcase name>" that
    resolves to a testcase in a committed JUnit XML with no failure / error /
    skipped child, and, for plans' `both`/`ios`/`android` IDs, a reference whose
    path contains the platform name for each required platform;
  * a video reference "video:<id>" must exist in docs/evidence/video_manifest.json
    with sha256, size_bytes and a junit testcase that passed;
  * summary.json `source_digest` must equal the digest recomputed from the
    working tree (evidence produced from different code is stale);
  * COMPLETE phase: every acceptance ID must be accounted for in some summary.

Usage:
  verify_evidence.py [--root DIR] [--print-digest]
Exit 0 = OK, 1 = problems (listed).
"""
from __future__ import annotations

import hashlib
import json
import pathlib
import re
import sys
import xml.etree.ElementTree as ET

STATUSES = {"PASS", "PARTIAL", "NOT_RUN", "BLOCKED"}
DIGEST_PATHS = ["src", "app", "e2e", "fixtures/manifest.json", "package-lock.json",
                "app.json", "app.config.js", "app.config.ts", "package.json"]


def plan_ids(root):
    """Return {id: platform} parsed from BUILD_PLAN.md acceptance table."""
    text = (root / "docs" / "BUILD_PLAN.md").read_text(encoding="utf-8")
    ids = {}
    for m in re.finditer(r"(?m)^\|\s*(A\d{2})\s*\|\s*(P[01])\s*\|\s*(\w+)\s*\|", text):
        ids[m.group(1)] = m.group(3)
    return ids


def source_digest(root):
    h = hashlib.sha256()
    files = []
    for rel in DIGEST_PATHS:
        p = root / rel
        if p.is_file():
            files.append(p)
        elif p.is_dir():
            for f in sorted(p.rglob("*")):
                if f.is_file() and "node_modules" not in f.parts:
                    files.append(f)
    for f in sorted(set(files)):
        h.update(str(f.relative_to(root)).encode("utf-8") + b"\0")
        h.update(hashlib.sha256(f.read_bytes()).hexdigest().encode("ascii") + b"\n")
    return h.hexdigest()


def junit_testcase_passed(root, ref):
    """ref = 'junit:<relpath>::<testcase name>' -> (ok, reason)."""
    m = re.fullmatch(r"junit:(.+?)::(.+)", ref)
    if not m:
        return False, "malformed test reference %r" % ref
    rel, name = m.group(1), m.group(2)
    path = root / rel
    if not path.is_file():
        return False, "missing JUnit file %s" % rel
    try:
        tree = ET.parse(str(path))
    except ET.ParseError as exc:
        return False, "unparseable JUnit %s: %s" % (rel, exc)
    found = False
    for tc in tree.iter("testcase"):
        if tc.get("name") == name:
            found = True
            for bad in ("failure", "error", "skipped"):
                if tc.find(bad) is not None:
                    return False, "testcase %r in %s has <%s>" % (name, rel, bad)
    if not found:
        return False, "testcase %r not found in %s" % (name, rel)
    return True, ""


def verify(root):
    problems = []
    status_file = root / "milestone-status.json"
    if not status_file.is_file():
        return ["missing milestone-status.json"]
    phase = json.loads(status_file.read_text()).get("phase")
    if phase not in ("PLAN_ONLY", "BUILDING", "COMPLETE"):
        return ["milestone-status.json: bad phase %r" % phase]
    ids = plan_ids(root)
    if not ids:
        return ["no acceptance IDs found in BUILD_PLAN.md"]

    evidence_dir = root / "docs" / "evidence"
    summaries = sorted(evidence_dir.glob("*/summary.json")) if evidence_dir.is_dir() else []

    if phase == "PLAN_ONLY":
        if summaries:
            problems.append("phase is PLAN_ONLY but evidence summaries exist: "
                            + ", ".join(str(s.relative_to(root)) for s in summaries))
        return problems

    manifest = {}
    mf = evidence_dir / "video_manifest.json"
    if mf.is_file():
        manifest = {v["id"]: v for v in json.loads(mf.read_text()).get("videos", [])}
    current_digest = source_digest(root)
    accounted = set()

    for sf in summaries:
        rel = str(sf.relative_to(root))
        try:
            data = json.loads(sf.read_text())
        except ValueError as exc:
            problems.append("%s: invalid JSON (%s)" % (rel, exc))
            continue
        if data.get("source_digest") != current_digest:
            problems.append("%s: stale evidence (source_digest does not match working tree)" % rel)
        for aid, entry in (data.get("acceptance") or {}).items():
            if aid not in ids:
                problems.append("%s: unknown acceptance ID %s" % (rel, aid))
                continue
            status = entry.get("status")
            if status not in STATUSES:
                problems.append("%s: %s has invalid status %r" % (rel, aid, status))
                continue
            accounted.add(aid)
            tests = entry.get("tests") or []
            if status == "PASS":
                if not tests:
                    problems.append("%s: %s is PASS without any test reference" % (rel, aid))
                for ref in tests:
                    ok, why = junit_testcase_passed(root, ref)
                    if not ok:
                        problems.append("%s: %s: %s" % (rel, aid, why))
                plat = ids[aid]
                needed = {"both": ["ios", "android"], "ios": ["ios"],
                          "android": ["android"]}.get(plat, [])
                for p in needed:
                    if not any(p in t.lower() for t in tests):
                        problems.append("%s: %s needs a %s test reference (platform %s)"
                                        % (rel, aid, p, plat))
            elif status in ("PARTIAL", "NOT_RUN", "BLOCKED") and not entry.get("notes"):
                problems.append("%s: %s is %s without notes explaining why" % (rel, aid, status))
            for v in entry.get("videos") or []:
                vid = v[len("video:"):] if v.startswith("video:") else v
                rec = manifest.get(vid)
                if not rec:
                    problems.append("%s: %s references missing video %s" % (rel, aid, vid))
                    continue
                for key in ("sha256", "size_bytes", "junit"):
                    if not rec.get(key):
                        problems.append("video %s missing %s" % (vid, key))
                if rec.get("junit"):
                    ok, why = junit_testcase_passed(root, rec["junit"])
                    if not ok:
                        problems.append("video %s: %s" % (vid, why))

    if phase == "COMPLETE":
        for aid in ids:
            if aid not in accounted:
                problems.append("COMPLETE phase: %s has no status in any summary.json" % aid)
    return problems


def main(argv):
    root = pathlib.Path(__file__).resolve().parents[1]
    if "--root" in argv:
        root = pathlib.Path(argv[argv.index("--root") + 1])
    if "--print-digest" in argv:
        print(source_digest(root))
        return 0
    problems = verify(root)
    if problems:
        print("verify_evidence: FAIL")
        for p in problems:
            print("  - " + p)
        return 1
    phase = json.loads((root / "milestone-status.json").read_text()).get("phase")
    print("verify_evidence: OK (phase %s, %d acceptance IDs defined)" % (phase, len(plan_ids(root))))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
