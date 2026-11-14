# AGENTS.md — postclip

## Mission

Build **postclip**: an installable single-page web app (React + TypeScript + Vite, PWA) that reads a screenshot of a social post in the browser (OCR), tidies the text with a small local language model where the browser can run one, lets the user review/edit it, and shares, copies or exports it. No cloud, no accounts, no stored posts, English only. The complete, linted specification is `docs/BUILD_PLAN.md`; follow it. This project lives at `projects/postclip/` inside the single smll monorepo: do not run `git init`, do not touch other projects (the native shell is the separate project `projects/postclip-builder`, which is not yours to change).

## Read first (in this order)

1. Monorepo-root `AGENTS.md` (branch / PR / evidence rules).
2. This file, `README.md`, `docs/BUILD_PLAN.md` **in full**, `docs/status.md`, `milestone-status.json`, `docs/evidence/`.
3. Run `bash scripts/verify.sh` and `bash scripts/preflight.sh`; resume from the ledger, not from chat history.

## Hard rules

- **Honesty over green.** Statuses are `PASS | PARTIAL | NOT_RUN | BLOCKED`. `PASS` is allowed only when a committed JUnit testcase that passed backs it (`scripts/verify_evidence.py` enforces this, per browser engine for `web` IDs). Never invent logs, numbers, hashes, versions, videos or screenshots. A check you did not run is `NOT_RUN` (e.g. real-device checks A27/A30, WebGPU).
- **Real components.** E2E tests drive real Chromium and WebKit through Playwright against the built app, with the real in-browser OCR engine and the real pinned model weights. Vitest may stub pure logic; stubs/mocks never count as evidence for OCR, LLM, offline, storage or share behavior. Spying on `navigator.share` to assert the payload is allowed (the OS share sheet is not automatable); faking the clipboard, permissions or the service worker *inside the app* to make a flow pass is not.
- **No storage, no telemetry, no cloud.** Allowed persistence is only the app-shell cache and the model cache; no post text in any storage, URL, history, console output or network request; no analytics/crash SDKs; a strict CSP; after the model is cached, processing makes zero network requests. See "Privacy and no-storage design".
- **Synthetic data only.** Fixtures are generated fictional posts; no real people, real screenshots, real brand marks or logos. The product does not scrape or call LinkedIn or any service.
- **Fail closed.** Bad/corrupt/unsupported input, a bad model file, invalid LLM output, or a failed guard degrades to the previous safe stage with a visible flag; nothing is silently dropped or invented.
- **Resolve versions at build time** (latest mutually compatible library versions), pin them in the lockfile, and record them in `docs/evidence/<slice>/versions.json`. Do not copy versions from this repo's docs or from web search snippets. Hashes and measurements must come from real downloads/runs and be recorded with the command that produced them.
- Test hooks and the eval runner exist only in dev/test builds and must be absent from the production build (A29).
- Never commit secrets, per-flow videos, model weights, `node_modules`, build output or machine-specific paths. The only committed video is the single ≤ 15 MB compilation from S6.

## Delivery loop (one slice = one PR)

Slices S0–S6 are defined in `docs/BUILD_PLAN.md`. For each slice:

1. `git checkout main && git pull --ff-only`; check the previous slice is `MERGED` on GitHub; run `bash scripts/preflight.sh` (BLOCKED if a required prerequisite is missing — plan D6 lists what you may install).
2. Branch `feature/postclip/S<n>-<short-name>`.
3. **RED first**: write failing behavioral tests (Vitest assertions, a Playwright flow failing on missing behavior, or an eval check failing). A scaffold that builds may be committed first. Build/import errors are not RED. Save real output and exit code to `docs/evidence/S<n>/red.log`.
4. **GREEN**: implement; run typecheck, lint, Vitest, Playwright e2e in Chromium **and** WebKit, the eval runs, negative tests and all prior regression; save `green.log`, `e2e.log`, `negative.log`, JUnit XML under `docs/evidence/S<n>/junit/` named `chromium*.xml`, `webkit*.xml` and `host*.xml`, plus `versions.json`.
5. **Record video** of every passing Playwright flow (Playwright's video recording) to `artifacts/video/` (never committed); append entries with sha256, size, duration and the JUnit testcase to `docs/evidence/video_manifest.json`. In S6 produce the single compressed compilation video and commit it.
6. Write `docs/evidence/S<n>/summary.json` (schema below), update `docs/status.md`, `milestone-status.json` and README commands. Set phase `BUILDING` in S0 and `COMPLETE` only when S6 is merged.
7. Review the staged diff for secrets/stray files; open **one PR** with `.github/pull_request_template.md`, honestly filled in, then follow the merge policy below.

### `summary.json` schema

```json
{
  "slice": "S0",
  "source_digest": "<output of: python3 scripts/verify_evidence.py --print-digest, run on the final tree>",
  "tested_on": {"os": "", "node": "", "chromium": "", "webkit": "", "container": "cpu/ram/disk"},
  "acceptance": {
    "A02": {
      "status": "PASS",
      "tests": ["junit:docs/evidence/S0/junit/chromium.xml::<testcase>", "junit:docs/evidence/S0/junit/webkit.xml::<testcase>"],
      "videos": ["video:uc01_chromium", "video:uc01_webkit"],
      "notes": ""
    }
  },
  "commands": {"red": {"command": "", "exit_code": 1, "evidence": "docs/evidence/S0/red.log"}},
  "limitations": []
}
```

`PARTIAL`, `NOT_RUN` and `BLOCKED` entries must carry `notes` explaining exactly what was and was not done. `video_manifest.json`: `{"videos":[{"id","path","sha256","size_bytes","duration_s","engine","junit":"junit:<path>::<testcase>"}]}`.

## Merge policy (owner-authorized, guarded)

Auto-merge and branch rulesets are unavailable on this repository plan, so the agent is the merge gate. You may `gh pr merge <PR> --squash` only when **all** hold: `monorepo / verify` passed on the PR head; `bash scripts/verify.sh` and the full local suite passed on the same tree with committed evidence whose `source_digest` matches; the diff contains only in-scope files; nothing is BLOCKED. Then verify GitHub reports `MERGED`, pull `main`, record the merge SHA in the **next** slice's status update (never in its own PR), and continue automatically.

Never: push to `main`, force-push, bypass checks, change repo/org/runner settings, edit `.github/` (unless the owner explicitly approves the single `setup-node` contingency in plan D1), spend money, tag or release, upload anything, install anything beyond plan D6.

## Stop conditions (report `BLOCKED`; do not improvise)

A missing required prerequisite, or the container running out of RAM/disk for a required step (report the real numbers; never silently skip required evidence); a build or test you cannot fix honestly within the slice after 3 genuine attempts; CI failing after 3 attempts or for an unattributable reason; anything requiring weakening/skipping/faking a test or inventing a number; the plan's premise contradicted by facts (comment on the PR with evidence first); the runner's Node too old for the toolchain (ask the owner).

## Reporting

After every merged PR: slice, branch, PR URL, each test command with exit code, evidence paths, per-acceptance-ID status table, video manifest entries, merge SHA from GitHub, limitations, next slice. After S6: final conformance summary (proven / partial / not run), the list of videos with paths and hashes, and `docs/BUILDER_HANDOFF.md`.
