# AGENTS.md — postclip

## Mission

Build **postclip**: an Expo / React Native app (iOS + Android) that reads a screenshot of a social post on-device (OCR), cleans the text with a small local LLM, lets the user review/edit it, and shares or exports it. No cloud, no accounts, no stored posts, English only. The complete, linted specification is `docs/BUILD_PLAN.md`; follow it. This project lives at `projects/postclip/` inside the single smll monorepo: do not run `git init`, do not touch other projects.

## Two stages, two hosts

This project is built in **two stages** (details in `docs/BUILD_PLAN.md`, "Two-stage execution"):

- **Stage L (Linux, Hermes on openclawlaunch.com, autonomous):** slices S0–S6. All app code, fixtures, Jest tests, typecheck/lint, host-side LLM evaluation with real weights, authored Maestro flows, tooling. The container is small and has no Xcode or emulator, so **every device-dependent acceptance ID is recorded `NOT_RUN`/`PARTIAL` with the note "awaiting Stage D"**. At the end of S6 set phase `DEVICE_VERIFICATION` and write `docs/STAGE_D_HANDOFF.md`. Then stop.
- **Stage D (the owner's Mac, interactive with Claude Code):** slices D0–D3. Device builds, Maestro flows on iOS simulator and Android emulator, video, real-OCR re-evaluation, final conformance. Hermes does not do Stage D.

## Read first (in this order)

1. Monorepo-root `AGENTS.md` (branch / PR / evidence rules).
2. This file, `README.md`, `docs/BUILD_PLAN.md` **in full**, `docs/status.md`, `milestone-status.json`, `docs/evidence/`.
3. Run `bash scripts/verify.sh` and `bash scripts/preflight.sh` (it auto-selects `linux` or `device` mode); resume from the ledger, not from chat history.

## Hard rules

- **Honesty over green.** Statuses are `PASS | PARTIAL | NOT_RUN | BLOCKED`. `PASS` is allowed only when a committed JUnit testcase that passed backs it (`scripts/verify_evidence.py` enforces this). Never invent logs, numbers, hashes, versions, videos or screenshots. A check you did not run is `NOT_RUN`.
- **Real components.** Device OCR runs through the real Apple Vision / ML Kit engines and the LLM through the real runtime with the real pinned weights. On Linux, LLM evaluation uses the real pinned weights via llama.cpp; OCR cannot be measured there and nothing (e.g. Tesseract) may stand in for it as evidence. Mocks and stubs are fine in Jest unit tests of pure logic; they never count as evidence for OCR, LLM, share, permission or storage behavior. No faking the clipboard, share intent or permission state inside the app to make a flow pass.
- **No storage, no telemetry, no cloud.** Only the model file and transient share/export temp files (deleted afterwards) may be written; no post text in logs, caches or AsyncStorage; no analytics/crash SDKs; after the model is `ready` the app makes no network calls. See "Privacy and no-storage design".
- **Synthetic data only.** Fixtures are generated fictional posts; no real people, real screenshots, real brand marks or logos. The product does not scrape or call LinkedIn or any service.
- **Fail closed.** Bad/corrupt/unsupported input, bad model file, invalid LLM output, or a failed guard degrades to the previous safe stage with a visible flag; nothing is silently dropped or invented.
- **Resolve versions at build time** (latest mutually compatible Expo SDK and libraries), pin them in the lockfile, and record them in `docs/evidence/<slice>/versions.json`. Do not copy versions from this repo's docs or from web search snippets.
- No Expo Go: dev client + config plugins only. TypeScript strict. Test hooks and eval-mode exist only in test builds.
- Never commit secrets, MP4/MOV files, model weights, `node_modules`, build outputs or machine-specific paths.

## Delivery loop (one slice = one PR)

Slices S0–S6 (Stage L) and D0–D3 (Stage D) are defined in `docs/BUILD_PLAN.md`. For each slice:

1. `git checkout main && git pull --ff-only`; check the previous slice is `MERGED` on GitHub; run `bash scripts/preflight.sh` (BLOCKED if required prerequisites are missing — see plan D5 for what you may install).
2. Branch `feature/postclip/<S|D><n>-<short-name>`.
3. **RED first**: write failing behavioral tests (Jest assertions and/or a Maestro flow failing on missing behavior). A scaffold that builds and launches may be committed first. Build/import errors are not RED. Save real output and exit code to `docs/evidence/S<n>/red.log`.
4. **GREEN**: implement; run everything that can run in your stage (Stage L: Jest, typecheck, lint, host demo, host LLM evaluation, fixtures/manifest lint; Stage D: also Maestro flows on **both** platforms) plus all prior regression; save `green.log`, `e2e.log`, `negative.log`, JUnit XML under `docs/evidence/<slice>/junit/` (device results in files whose names contain `ios` or `android`; host results in `linux*.xml`), `versions.json`.
5. **Stage D only — record video** of every passing Maestro flow (`maestro record --local` for iOS simulator and Android emulator, or `xcrun simctl io <udid> recordVideo` / `adb shell screenrecord` driven around the passing flow). Videos go to `artifacts/video/` (never committed). Append entries to `docs/evidence/video_manifest.json`. Stage L records no video.
6. Write `docs/evidence/S<n>/summary.json` (schema below), update `docs/status.md`, `milestone-status.json` and README commands. Set phase `BUILDING` in S0, `DEVICE_VERIFICATION` at the end of S6, and `COMPLETE` only when D3 is merged.
7. Review the staged diff for secrets/stray files; open **one PR** with `.github/pull_request_template.md`, honestly filled in, then follow the merge policy below.

### `summary.json` schema

```json
{
  "slice": "S0",
  "source_digest": "<output of: python3 scripts/verify_evidence.py --print-digest, run on the final tree>",
  "tested_on": {"macos": "", "xcode": "", "ios_simulator": "", "android_emulator": "", "node": ""},
  "acceptance": {
    "A02": {
      "status": "PASS",
      "tests": ["junit:docs/evidence/S0/junit/ios.xml::<testcase>", "junit:docs/evidence/S0/junit/android.xml::<testcase>"],
      "videos": ["video:uc01_ios", "video:uc01_android"],
      "notes": ""
    }
  },
  "commands": {"red": {"command": "", "exit_code": 1, "evidence": "docs/evidence/S0/red.log"}},
  "limitations": []
}
```

`PARTIAL`, `NOT_RUN` and `BLOCKED` entries must carry `notes` explaining exactly what was and was not done. `video_manifest.json`: `{"videos":[{"id","path","sha256","size_bytes","duration_s","platform","junit":"junit:<path>::<testcase>"}]}`.

## Merge policy (owner-authorized, guarded)

Auto-merge and branch rulesets are unavailable on this repository plan, so the agent is the merge gate. **Stage L (Hermes):** you may `gh pr merge <PR> --squash` only when `monorepo / verify` passed on the PR head, `bash scripts/verify.sh` passed locally, the diff contains only in-scope files, and nothing is BLOCKED. **Stage D (Claude Code with the owner):** the same, plus `bash scripts/verify.sh --device` passed on the Mac for the same tree with a matching `source_digest`, and the owner has said to merge. Then verify GitHub reports `MERGED`, pull `main`, record the merge SHA in the **next** slice's status update (never in its own PR), and continue.

Never: push to `main`, force-push, bypass checks, change repo/org/runner settings, spend money (including paid cloud devices or EAS builds), tag or release, upload videos anywhere, install anything beyond plan D5.

## Stop conditions (report `BLOCKED`; do not improvise)

A missing required prerequisite, or the container running out of RAM/disk for a required step (report the real numbers; never silently skip required evidence); a build you cannot fix honestly within the slice after 3 genuine attempts; CI failing after 3 attempts or for an unattributable reason; a Testability-map technique proving infeasible with no honest `PARTIAL`; anything requiring weakening/skipping/faking a test or inventing a number; the plan's premise contradicted by facts (comment on the PR/issue with evidence first); the D1 decision in `milestone-status.json` not being `split_with_root_exception` when S0 needs the scoped shared-CI change.

## Reporting

After every merged PR: slice, branch, PR URL, each test command with exit code, evidence paths, per-acceptance-ID status table, video manifest entries, merge SHA from GitHub, limitations, next slice. After S6: final conformance summary (proven / partial / not run) and the list of videos with paths and hashes.
