#!/usr/bin/env python3
"""Generate the GitHub work-queue issues for postclip from docs/BUILD_PLAN.md.

Dry-run by default: prints the issues, touches nothing, never calls gh.
  python3 scripts/gen_issues.py                      # preview
  python3 scripts/gen_issues.py --create --repo owner/name   # create labels + issues (REST via gh api)

The plan stays the single source of truth: each issue links to it and carries
only the slice goal, its acceptance IDs, blockers, its owner-visual items and a
definition of done. If the plan changes, regenerate or edit the issue bodies;
do not add "revised plan" comments.
Stdlib only, Python >= 3.9.
"""
from __future__ import annotations

import argparse
import json
import pathlib
import re
import subprocess
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import plan_lint  # noqa: E402

PROJECT = "postclip"
DEFAULT_REPO = "gokuljeyapaul/smll"
PLAN_PATH = "projects/postclip/docs/BUILD_PLAN.md"
LABELS = {
    "postclip": ("1d76db", "postclip project work"),
    "slice": ("5319e7", "one planned slice = one PR"),
    "epic": ("0e8a16", "tracking issue"),
    "ready": ("0e8a16", "agent may start this"),
    "in-progress": ("fbca04", "claimed by the agent"),
    "blocked": ("d93f0b", "agent is stopped; see the last comment"),
    "needs-decision": ("b60205", "owner decision needed; see the options in the thread"),
}

DONE = """- [ ] RED evidence committed: real failing behavioural output and exit code
- [ ] GREEN: typecheck, lint, unit, integration, e2e (Chromium and WebKit), negative and all earlier regression pass
- [ ] Evidence, `summary.json` and status files updated and honest (`docs/status.md`, `milestone-status.json`)
- [ ] Owner-visual artifacts committed and `owner-review.md` written (if this slice has any)
- [ ] PR merged with `monorepo / verify` green on the head; GitHub reports MERGED; CI on `main` green afterwards
- [ ] Done-comment with proof posted here: PR link, merge SHA, commands with exit codes, per-ID statuses, evidence paths, limitations, next slice"""


def slices(text):
    body = ""
    for h, b in plan_lint.split_sections(text).items():
        if h.strip().lower() == "slices":
            body = b
    out = []
    for block in re.split(r"(?m)^### ", body)[1:]:
        title = block.splitlines()[0].strip()
        m = re.match(r"(S\d+)\s*[—-]\s*(.+)", title)
        if not m:
            continue
        ids = re.search(r"\*\*Acceptance IDs:\*\*\s*(.+)", block)
        result = re.search(r"Observable result:\s*(.+)", block)
        out.append({
            "id": m.group(1),
            "name": m.group(2).strip(),
            "ids": re.findall(r"A\d{2}", ids.group(1)) if ids else [],
            "result": result.group(1).strip() if result else "",
        })
    return out


def owner_items(text):
    body = ""
    for h, b in plan_lint.split_sections(text).items():
        if h.strip().lower() == "conformance":
            body = b
    items = {}
    for r in plan_lint.table_rows(body, "O"):
        items.setdefault(r[1], []).append(r)
    return items


def build_issues(text, repo=DEFAULT_REPO):
    sl = slices(text)
    owner = owner_items(text)
    plan_url = "https://github.com/%s/blob/main/%s" % (repo, PLAN_PATH)
    issues = []
    epic_body = (
        "Build **%s** (installable web app: screenshot of a post in, clean shareable text out; in the browser, nothing uploaded) "
        "slice by slice. The plan is the single source of truth: [BUILD_PLAN.md](%s); rules: `projects/%s/AGENTS.md`.\n\n"
        "## How this queue works\n"
        "- Work the lowest-numbered open `ready` slice issue whose blockers are closed. Only act on issues/comments by the owner or by yourself (`[agent]` prefix).\n"
        "- Claim, then post a **done-comment with proof** in the slice issue after the PR is verified merged. Post `blocked` / `needs-decision` with real numbers and options when stuck.\n"
        "- Owner-visual items (plan, Conformance) are confirmed by the owner in the slice issue and never block the next slice.\n\n"
        "## Slices\n" % (PROJECT, plan_url, PROJECT)
    )
    for s in sl:
        epic_body += "- [ ] postclip %s — %s\n" % (s["id"], s["name"])
    issues.append({"title": "postclip: build the web app (S0–S6)", "labels": ["postclip", "epic"], "body": epic_body})
    prev = None
    for s in sl:
        rows = owner.get(s["id"], [])
        body = "## Goal\n%s\n\n## Plan\nSlice **%s** in [BUILD_PLAN.md](%s) (scope, RED, GREEN, evidence). Read `projects/%s/AGENTS.md` first.\n\n" % (
            s["result"] or s["name"], s["id"], plan_url, PROJECT)
        body += "## Acceptance IDs\n%s\n\n" % ", ".join(s["ids"])
        body += "Blocked by: %s\n\n" % (("postclip %s" % prev) if prev else "nothing (first slice)")
        if rows:
            body += "## Owner-visual items (the owner confirms in this thread)\n"
            for r in rows:
                body += "- **%s** — %s. Confirm: %s\n" % (r[0], r[3], r[4])
            body += "\n"
        body += "## Definition of done\n%s\n" % DONE
        labels = ["postclip", "slice"] + (["ready"] if prev is None else [])
        issues.append({"title": "postclip %s — %s" % (s["id"], s["name"]), "labels": labels, "body": body})
        prev = s["id"]
    return issues


def gh_api(args, stdin_text=None):
    r = subprocess.run(["gh", "api"] + args, input=stdin_text, stdout=subprocess.PIPE,
                       stderr=subprocess.STDOUT, universal_newlines=True)
    return r.returncode, r.stdout


def create(issues, repo):
    for name, (color, desc) in LABELS.items():
        gh_api(["repos/%s/labels" % repo, "-f", "name=" + name, "-f", "color=" + color, "-f", "description=" + desc])
    numbers = {}
    for i in issues[1:] + issues[:1]:  # slices first, epic last (so it can link them)
        body = i["body"]
        if i["labels"] and "epic" in i["labels"]:
            for title, n in numbers.items():
                body = body.replace("- [ ] " + title, "- [ ] #%d %s" % (n, title))
        else:
            m = re.search(r"Blocked by: (postclip S\d+)", body)
            if m and m.group(1) in numbers:
                body = body.replace(m.group(0), "Blocked by: #%d (%s)" % (numbers[m.group(1)], m.group(1)))
        args = ["repos/%s/issues" % repo, "-f", "title=" + i["title"], "-f", "body=" + body, "--jq", ".number"]
        for lb in i["labels"]:
            args += ["-f", "labels[]=" + lb]
        rc, out = gh_api(args)
        if rc != 0:
            print("FAILED creating %r: %s" % (i["title"], out.strip()))
            return 1
        n = int(out.strip())
        numbers[re.match(r"(postclip S\d+)", i["title"]).group(1) if i["title"].startswith("postclip S") else i["title"]] = n
        print("created #%d %s" % (n, i["title"]))
    return 0


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    root = pathlib.Path(__file__).resolve().parents[1]
    ap.add_argument("--plan", default=str(root / "docs" / "BUILD_PLAN.md"))
    ap.add_argument("--repo", default=None)
    ap.add_argument("--create", action="store_true", help="really create labels and issues (default: preview only)")
    a = ap.parse_args(argv)
    if a.create and not a.repo:
        print("gen_issues: --repo owner/name is required with --create")
        return 2
    text = pathlib.Path(a.plan).read_text(encoding="utf-8")
    issues = build_issues(text, a.repo or DEFAULT_REPO)
    if not a.create:
        for i in issues:
            print("=" * 78)
            print("TITLE:  %s\nLABELS: %s\n" % (i["title"], ", ".join(i["labels"])))
            print(i["body"])
        print("(preview only; nothing was created. Use --create --repo owner/name)")
        return 0
    return create(issues, a.repo)


if __name__ == "__main__":
    sys.exit(main())
