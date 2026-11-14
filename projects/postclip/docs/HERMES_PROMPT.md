# One-shot prompt for Hermes (openclawlaunch, Linux)

Use after the postclip plan PR is merged to `main`. Paste everything inside the block.

```text
Work in the smll monorepo (GitHub: gokuljeyapaul/smll), project projects/postclip. Build the whole web app, slice by slice, autonomously, until S6 is merged or you hit a stop condition. You are in a Linux container; everything in this plan is verifiable here with real browsers (Playwright Chromium + WebKit), real in-browser OCR and the real pinned model.

1. git checkout main && git pull. Confirm projects/postclip/docs/BUILD_PLAN.md and projects/postclip/AGENTS.md exist and that BUILD_PLAN.md is the WEB plan (title "BUILD_PLAN — postclip (web app)"). If not, stop and tell me.
2. Read in full: root AGENTS.md, projects/postclip/AGENTS.md, README.md, docs/BUILD_PLAN.md, docs/status.md, milestone-status.json. They are the authority for slices S0-S6, acceptance IDs A01-A32, use cases UC01-UC14, evidence schema, merge policy and stop conditions.
3. Run: bash scripts/preflight.sh (it picks the mode itself). Record RAM, disk and tool versions in the evidence. You may install ONLY what plan decision D6 lists: ffmpeg and Playwright's system dependencies (apt-get), Playwright Chromium + WebKit, and project-local npm ci. Nothing else. If a required prerequisite is missing or the container is too small for a required step, STOP and report BLOCKED with the real numbers. Never skip required evidence silently.

Mission: implement S0, S1, S2, S3, S4, S5, S6 in order, one PR per slice. For each slice: RED first (real failing assertions, real output and exit code saved), then GREEN with typecheck, lint, Vitest, Playwright e2e in Chromium AND WebKit, the eval runs, negative tests and all prior regression. Record video of every passing Playwright flow to artifacts/video/ (never committed) and list each in docs/evidence/video_manifest.json with sha256, size, duration and its JUnit testcase. Write JUnit files named chromium*.xml, webkit*.xml and host*.xml, a summary.json with source_digest per the schema in AGENTS.md, and update docs/status.md and milestone-status.json. Honest statuses only: PASS needs a passing JUnit testcase per required engine; anything you could not run is NOT_RUN/PARTIAL/BLOCKED with notes (real-device checks A27/A30 and WebGPU are NOT_RUN). Never invent numbers, hashes, logs, versions or videos. Resolve library versions yourself at build time, pin them, and record them in versions.json. Select the OCR engine (S0) and the LLM runtime/model (S4) BY MEASUREMENT on the fixtures with the criteria in the plan, and record the comparison tables. If no LLM candidate meets the bars, ship it disabled by default with the measured numbers (valid completion).

Apply the LLM safety design and the privacy/no-storage design exactly (constrained JSON output, validator, faithfulness guard, fallback, injection fixtures; allowed persistence only app-shell and model caches; strict CSP; zero network requests after the model is cached; storage/log/request audits after every flow). Fixtures are synthetic only (fictional names, no real brands or logos). Also deliver the host bridge and docs/BUILDER_CONTRACT.md (S2) and, in S6, docs/BUILDER_HANDOFF.md plus one compressed compilation video (<= 15 MB, <= 720p) committed under docs/demo/.

CI: the shared workflow already runs your scripts on ubuntu-latest; do NOT edit .github/. If the runner's Node is too old for the toolchain, stop and ask me for the single setup-node change (plan D1).

Merging: follow "Merge policy" in projects/postclip/AGENTS.md. Merge your own PR with gh pr merge --squash only after monorepo / verify is green on the PR head AND bash scripts/verify.sh and the full local suite passed on the same tree with matching evidence; then verify GitHub reports MERGED, pull main, and continue to the next slice automatically.

Never: push to main, force-push, bypass checks, spend money, tag/release, upload anything, commit model weights or per-flow videos or secrets, or touch other projects (including projects/postclip-builder). Stop and report BLOCKED on any stop condition in AGENTS.md; do not improvise or weaken a test.

After each merged PR post the report defined in AGENTS.md. At the end give the table of all 32 acceptance IDs with honest statuses, the video list with paths and hashes, and the builder handoff summary.
```
