# AGENTS.md — Coaching Transcript Privacy Pipeline

## Mission and instructions

Build a **production-evolvable, offline, CPU-first, non-generative** privacy-processing PoC using exclusively fictional coaching text and synthetic audio. Implement working code; do not stop at architecture or a notebook. Preserve the same reusable Python package in production. No generative LLM, paid AI API, public upload app, real coaching data or production deployment in the PoC.

This project is located at `projects/coaching-privacy-pipeline/` **inside one GitHub monorepo**. First read the **monorepo-root `AGENTS.md`** for mandatory TDD, branch/PR/merge/continue rules. Then read this project's `README.md`, `docs/BUILD_PLAN.md` **in full**, `docs/status.md`, `milestone-status.json` if present, existing tests, and recent evidence. The autonomous agent (Atina) may not automatically load nested project files; explicitly read them. Do not run `git init` here.

## Mandatory technical constraints

- Python 3.11, `src/coaching_privacy/`, typed interfaces, pytest, real Microsoft Presidio + spaCy NER from S0, real **GLiNER Medium v2.1** offline CPU inference by S3, and real faster-whisper speech-to-text by S5. Deterministic risk rules and transformations only, no generative rewriting.
- Pin exact model snapshots and checksums; audit model/code/weights/tokenizer licenses and resolved dependencies. Controlled setup may download artifacts once; execution must remain offline. Missing mandatory components or privacy validators **fail closed**. Do not silently use mocks for required integration tests.
- `fixtures/` and `policies/` contain synthetic-only inputs. Keep gold annotations and the fictional identity-linkage directory out of detector/transformer inputs. Do not infer protected characteristics; preserve relevant coaching meaning and speaker turns.
- No unapproved external AI/cloud inference, telemetry, secret exposure, raw real-client data or model binaries committed to Git. Any model/validation omission must be recorded as `NOT_RUN`/`BLOCKED`, not `PASS`.
- Synthetic test success does **not** establish anonymity, fairness, ICF certification or privacy-law conformance. Real-data processing requires a separate security/ethics/consent review.

## Strict vertical-slice delivery: S0–S7

Each slice in `docs/BUILD_PLAN.md` must deliver a complete user-observable behavior, independently testable end-to-end. Follow the **root `AGENTS.md`** sequence:

1. Create a feature branch from the protected integration branch; one feature slice = one PR.
2. Write and execute behavioral **RED** unit/integration/E2E tests before implementation; preserve actual failing assertion and nonzero exit in `docs/evidence/S#/red.log`.
3. Implement **GREEN** functionality with real models when required. Refactor. Run affected unit, integration, E2E, regression and fail-closed negative-path tests. Save actual logs and `summary.json` in the same evidence directory.
4. Demonstrate the complete input → detection → transformation → independent validation → safety decision → output path; ensure tests remain green and no sensitive data is present in evidence.
5. Update `docs/status.md` (human ledger), `milestone-status.json` (resumption state), `README.md` (real commands) and acceptance traceability. The PR must already contain evidence and status marked **`READY_FOR_MERGE`**, not falsely `MERGED`.
6. Commit and push the scoped feature branch; create a PR using the root `.github/pull_request_template.md`. Confirm `monorepo / verify` CI, required reviews and rulesets. Remediate failures until mergeable.
7. Request **authorized auto-merge**, then verify GitHub actually reports `MERGED`; only then proceed automatically to the next dependent slice. No routine approval between already-mergeable slices; independent required reviews or permissions are real blockers and must never be bypassed.
8. Record the verified merge SHA in the next PR's status update. For S7 use an authorized final documentation closeout PR or record the SHA via an authoritative GitHub PR link in the completion report until closeout.

Do not mark a slice fully **DELIVERED** until its PR is actually merged. Intermediate RED commits may fail CI; the final PR head must be green. Preserve `RED`, `GREEN`, `E2E`, `negative`, and `regression` proof; never invent logs or screenshots. A missing required model, test, evidence, review or permission is `BLOCKED`, and dependent slices must not advance. Continue independent work only when safe.

## Mandatory project commands

The agent must implement and execute:

```bash
bash scripts/setup.sh
bash scripts/test.sh
bash scripts/demo.sh
bash scripts/verify.sh
make test demo verify
```

These scripts do **not** exist in the seed handoff; S0 must create functioning versions, and CI must fail if required scripts are absent. The scripts must be safe to invoke from any current directory, fail nonzero on mandatory errors, and validate real Presidio behavior. From S3, real GLiNER must run; from S5, real offline synthetic-audio ASR must run. No GPU or paid API should be necessary for the CPU baseline; if GitHub-hosted runners are too small, configure a capable approved CI runner rather than weakening a test.

## Evidence contract and progress

- Preserve real, bounded, sanitized evidence at `docs/evidence/S#/red.log`, `green.log`, `e2e.log`, `negative.log`, `summary.json`, plus `regression.log`, `offline.log`, `test-results.xml`, genuine screenshots and model manifests where applicable.
- Include exact test identifiers, command exit codes, observed counts, acceptance IDs, model IDs/revisions, false negatives/denominators, risks and evidence links in `docs/status.md`. `milestone-status.json` must agree with real evidence.
- Before PR merge, record the PR URL/branch and state `READY_FOR_MERGE` if all local gates pass. After actual merge, verify GitHub state; record commit SHA later as specified above. Never claim `MERGED` inside its own unmerged PR.
- Resume by inspecting project source, Git state, status ledger and evidence; do not rely on chat history. Honor the root monorepo Git rules. Report status after each merged PR and automatically continue to the next slice unless blocked.

## Post-S7 issue-driven work (hardening and follow-ups)

`milestone-status.json` state `COMPLETE` and the S0–S7 ledger describe the original slices only. Further work is tracked as GitHub issues in this repository (`gh issue list`). These rules add to, and where they conflict take precedence over, the S0–S7 rules above for this work.

### Which plan to follow
- Open issues #9–#17 each have an older plan comment and a later comment titled **"Revised Solution Plan (supersedes the earlier plan comment)"**. Follow **only the latest revised comment**. Issues #18–#23 carry their plan in the issue body.
- If code on `main` contradicts a plan's premise, or a "Step 0: verify" item turns out false, stop, record the finding in the evidence bundle, and adjust the slice honestly (a regression guard instead of a fix is a valid outcome). Do not edit the issues' scope silently; post a comment explaining the change.

### Order (dependencies are hard; do not start an issue before its dependencies are MERGED)
1. #18 model pinning → #16 fast/slow markers → #22 independent validator
2. #19 ASR confidence (after #18) → #20 GLiNER windowing → #21 batch CLI wiring
3. #12 CSV mapping (after #21) → #23 (slice 1 anytime; slice 2 after #21) → #11 slice 1 (after #19) → #13 (after #18, #19)
4. #9 (after #16, #18, #20) → #10 (after #16, #20, #22) → #14 (after #16)
5. #17 design doc (after #20) → #11 slice 2 (after #18, #19, #9) → #15 release (last; after #14, #16, #22)

### Pacing and scope
- **One issue slice = one PR.** Issues with several slices (#9, #10, #11, #13, #23, #17) get one PR per slice. The owner has authorized **autonomous operation**: after a PR is merged and verified `MERGED`, continue automatically to the next item in the order above, without asking, until the list is finished or a stop condition below occurs.
- Branch: `feature/coaching-privacy-pipeline/I<issue>-S<slice>-<short-name>` (e.g. `I18-S1-verify-models`). Evidence: `docs/evidence/I<issue>-S<slice>/` with the usual `red.log`, `green.log`, `e2e.log`, `negative.log`, `summary.json`. Do not invent new `S#` slice numbers.
- Tooling, test-infrastructure and honesty-fix slices (#16, #18, #19, #20, #21, #22, #23 slice 1, #14, #15, #17) are owner-requested and authorized under the root `AGENTS.md` exceptions for non-capability work. They still need RED-first behavioral tests (where code changes), evidence, and status updates.
- Real-model claims must come from real inference. Stubs or injected extractors (#16) are allowed only in the fast lane and never count as model evidence. Hashes, revisions and calibration values must come from real downloads/runs and be recorded with the command that produced them.
- Do not tag, create releases, push tags, or upload release assets (#15) without explicit owner confirmation in the session.

### Merging (agent merges its own PRs — owner-authorized)
- Repository auto-merge is **disabled** and branch rulesets/protection are unavailable on this plan, so `monorepo / verify` is not an enforced required check. Do not try to enable these settings. The agent is therefore the merge gate and must enforce the conditions below itself.
- The agent **may merge its own PR** (`gh pr merge <PR> --squash`) only when ALL hold: (1) `gh pr checks <PR>` shows `monorepo / verify` **passed** on the current PR head (wait for it; never merge on pending/failed/missing checks); (2) the PR contains the RED/GREEN/e2e/negative evidence and updated `docs/status.md` / `milestone-status.json` (`READY_FOR_MERGE`); (3) the diff touches only files in scope (review `git diff origin/main...HEAD --stat` for stray files, secrets, models, large data); (4) no unresolved BLOCKED item.
- Never push to `main`, force-push, bypass checks, use admin override, or merge a PR you did not open. After merging, verify with `gh pr view <PR> --json state,mergeCommit` that GitHub reports `MERGED`, then `git checkout main && git pull --ff-only`. Record the merge SHA in the **next** PR's status update (never in its own PR).
- **Gate-impact rule** for changes to `pipeline.py`, `validator.py`, language/ASR gates or detection thresholds: the PR body must include a before/after decision table for all 18 seed fixtures. No fixture decision may become more permissive (e.g. REVIEW_REQUIRED → RELEASE_CANDIDATE, BLOCKED → anything lower) unless that fixture is named and justified in the plan (e.g. #10 slice 2). Any unexplained more-permissive change is a **stop condition**.

### Stop conditions (stop the run and report BLOCKED — do not improvise)
- `monorepo / verify` still failing after 3 genuine fix attempts on the same PR, or a failure you cannot attribute.
- A dependency in the order list is not merged, or a required model/download/permission is unavailable after retries.
- A plan's "Step 0" finding or any code fact invalidates the plan beyond the alternatives the plan itself allows (post an issue comment with the evidence, then stop).
- Anything requiring weakening, skipping or mocking a required test, or inventing a log/hash/number.
- Issue #15 (tag/release): **always stop and ask the owner** before `git push --tags` or `gh release create`; also stop if the repo/CI state does not match the plan's preconditions. Everything else in the order list may proceed autonomously.
- A gate-impact violation (see above), or a diff that touches files outside the project plus necessary `.github/` changes.

### Reporting
After each merged PR, post a short report (project, issue/slice, branch, PR URL, test commands with exit codes, evidence paths, merge SHA from GitHub, limitations, next item). At the end of the run (list finished or BLOCKED), give a summary table of issue → PR → merged SHA → status.

### CI note
Any change under `projects/coaching-privacy-pipeline/**`, including docs-only PRs, runs the full setup/test/demo/verify cycle (model downloads, no cache). Expect long CI runs; do not weaken tests to speed them up.
