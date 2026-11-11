# AGENTS.md — Coaching Transcript Privacy Pipeline

## Mission and instructions

Build a **production-evolvable, offline, CPU-first, non-generative** privacy-processing PoC using exclusively fictional coaching text and synthetic audio. Implement working code; do not stop at architecture or a notebook. Preserve the same reusable Python package in production. No generative LLM, paid AI API, public upload app, real coaching data or production deployment in the PoC.

This project is located at `projects/coaching-privacy-pipeline/` **inside one GitHub monorepo**. First read the **monorepo-root `AGENTS.md`** for mandatory TDD, branch/PR/merge/continue rules. Then read this project's `README.md`, `docs/BUILD_PLAN.md` **in full**, `docs/status.md`, `milestone-status.json` if present, existing tests, and recent evidence. OpenClaw may not automatically load nested project files; explicitly read them. Do not run `git init` here.

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
