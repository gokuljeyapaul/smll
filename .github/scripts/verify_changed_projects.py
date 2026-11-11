#!/usr/bin/env python3
"""Shared monorepo CI: detect changed projects and run their real scripts.

For every project touched by the diff (vs the PR base), run in order:
  scripts/setup.sh, scripts/test.sh, scripts/demo.sh, scripts/verify.sh
A missing mandatory script for a touched project is a failure (never PASS).
Never applies `paths` filtering to this single required gate; internal change
detection selects which projects run.
"""
from __future__ import annotations

import os
import pathlib
import subprocess
import sys

REPO_ROOT = pathlib.Path(__file__).resolve().parents[2]
PROJECTS_DIR = REPO_ROOT / "projects"
REQUIRED_SCRIPTS = ["setup.sh", "test.sh", "demo.sh", "verify.sh"]


def changed_files() -> set[str]:
    env = os.environ
    if env.get("GITHUB_EVENT_NAME") == "pull_request":
        base = env.get("GITHUB_BASE_REF", "main")
        cmd = ["git", "fetch", "--no-tags", "origin", base, "&&", "git", "diff", "--name-only", f"origin/{base}..."]
        # run via shell for the chained fetch+diff
        out = subprocess.run(" ".join(cmd), shell=True, capture_output=True, text=True, cwd=REPO_ROOT)
        if out.returncode != 0:
            print(out.stdout, out.stderr)
            raise SystemExit(f"git diff failed: {out.returncode}")
        return set(out.stdout.split())
    # push event: compare against the previous commit
    out = subprocess.run(
        ["git", "diff", "--name-only", "HEAD^", "HEAD"],
        capture_output=True, text=True, cwd=REPO_ROOT,
    )
    if out.returncode != 0:
        print(out.stdout, out.stderr)
        raise SystemExit(f"git diff failed: {out.returncode}")
    return set(out.stdout.split())


def touched_projects(files: set[str]) -> list[str]:
    projects = []
    if not PROJECTS_DIR.is_dir():
        return projects
    known = {p.name for p in PROJECTS_DIR.iterdir() if p.is_dir()}
    for f in files:
        parts = pathlib.PurePosixPath(f).parts
        if len(parts) >= 2 and parts[0] == "projects" and parts[1] in known:
            if parts[1] not in projects:
                projects.append(parts[1])
    return projects


def main() -> int:
    files = changed_files()
    projects = touched_projects(files)
    if not projects:
        print("monorepo verify: no project directories touched; nothing to run.")
        return 0
    print(f"monorepo verify: projects to verify: {projects}")
    failures = []
    for project in projects:
        project_dir = PROJECTS_DIR / project
        for script in REQUIRED_SCRIPTS:
            path = project_dir / "scripts" / script
            if not path.is_file():
                print(f"FAIL {project}: missing mandatory script scripts/{script}")
                failures.append(f"{project}:missing {script}")
                break
            print(f"RUN {project}: bash scripts/{script}")
            result = subprocess.run(
                ["bash", str(path)], cwd=str(project_dir),
                env={**os.environ, "CI": "1"},
            )
            if result.returncode != 0:
                print(f"FAIL {project}: scripts/{script} exit {result.returncode}")
                failures.append(f"{project}:{script}")
                break
        else:
            print(f"PASS {project}: all mandatory scripts green")
    if failures:
        print(f"monorepo verify FAILED: {failures}")
        return 1
    print("monorepo verify OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
