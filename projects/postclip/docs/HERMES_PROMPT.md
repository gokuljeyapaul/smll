# One-shot prompt for the building agent (Hermes)

Use after the postclip plan PR is merged to `main`. Paste everything inside the block.

```text
Work in the smll monorepo (GitHub: gokuljeyapaul/smll), project projects/postclip. Build the whole app, slice by slice, autonomously, until S6 is merged or you hit a stop condition.

1. git checkout main && git pull. Confirm projects/postclip/docs/BUILD_PLAN.md and projects/postclip/AGENTS.md exist. If not, stop and tell me.
2. Read in full: root AGENTS.md, projects/postclip/AGENTS.md, README.md, docs/BUILD_PLAN.md, docs/status.md, milestone-status.json. Follow them exactly; AGENTS.md and BUILD_PLAN.md are the authority for slices S0-S6, acceptance IDs A01-A31, use cases UC01-UC14, evidence schema, merge policy and stop conditions.
3. Run: bash scripts/preflight.sh. If anything is missing: you may brew install ONLY maestro, ffmpeg and facebook/fb/idb-companion, and run project-local npm commands. Do NOT install or change Xcode, Android SDK/emulators, system settings, or anything else. If prerequisites are still missing, STOP and report BLOCKED with the preflight report.

Mission: implement S0, S1, S2, S3, S4, S5, S6 in order, one PR per slice. For each slice: RED first (real failing behavioral tests, real output and exit code saved), then GREEN on BOTH iOS simulator and Android emulator with real components (real OCR engines, real LLM runtime and pinned weights, real share/permission behavior; no mocks as evidence), Maestro flows for every use case in the slice, a recorded video of every PASSING flow (artifacts/video/, never committed) listed in docs/evidence/video_manifest.json with sha256, JUnit XML evidence, summary.json with source_digest, updated docs/status.md and milestone-status.json. Honest statuses only: PASS needs a passing JUnit testcase; anything you could not run is NOT_RUN/PARTIAL/BLOCKED with notes. Never invent numbers, hashes, logs, versions or videos. Resolve library and Expo SDK versions yourself at build time, pin them, and record them.

Merging: follow the "Merge policy" in projects/postclip/AGENTS.md. Merge your own PR only after monorepo / verify is green on the PR head AND bash scripts/verify.sh --device passed on this Mac for the same tree with matching evidence, then verify GitHub reports MERGED, pull main, and continue to the next slice automatically.

Decision D1 (CI): the owner's decision is recorded in projects/postclip/milestone-status.json under owner_decisions.D1_ci_strategy. If it says PENDING_OWNER_CONFIRMATION, do NOT modify anything under .github/ ; STOP at the point where S0 needs it and ask me.

Never: push to main, force-push, bypass checks, change repo/org/runner settings, spend money, tag/release, upload videos anywhere, commit MP4/model files/secrets. Do not touch other projects.

Stop and report BLOCKED (do not improvise) on any stop condition in AGENTS.md. The riskiest techniques (iOS share extension via Photos, simulator clipboard images, radio-off on iOS) must be verified feasible first; if infeasible, record PARTIAL with exactly what was and was not automated; never fake them inside the app.

After each merged PR post the report defined in AGENTS.md (slice, branch, PR URL, test commands + exit codes, evidence paths, per-ID status table, video entries, merge SHA, limitations, next slice). At the end give the final conformance summary: what is proven, what is partial, what was not run, and the list of videos with paths and hashes.
```
