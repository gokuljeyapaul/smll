# Coaching Transcript Privacy Pipeline

**Project state:** v8.0 functionality-first, strict-TDD, **one merged PR per slice**, offline non-generative engineering specification and fictional seed data. The application, scripts and pipeline are **to be implemented** by the coding agent as feature-slice checkpoints. This is not an already-working anonymization tool.

## Goal
Build and validate a reusable Python processing engine for coaching **transcripts and audio**, starting with a browser-accessible/CPU-first synthetic-data PoC and progressing to a security-reviewed production batch service without rewriting privacy logic.

The software will detect direct identifiers, contextual and combined re-identification clues, and sensitive disclosures; apply purpose-driven transformations; validate residual leakage and coaching-meaning preservation independently; and report one of `RELEASE_CANDIDATE`, `REVIEW_REQUIRED`, `BLOCKED`, `FAILED` for **fictional** demonstrations.

**No real coaching data in the PoC.** Even a `RELEASE_CANDIDATE` is only an internal synthetic benchmark decision, not approval to distribute or proof of anonymity, legal compliance or ICF compliance.

## Repository layout — single Git monorepo
```text
openclaw-projects/                  # ONE .git directory at this root
├── AGENTS.md                       # Global rules for all projects (owned separately)
└── projects/
    └── coaching-privacy-pipeline/
        ├── AGENTS.md               # Project operating instructions
        ├── README.md               # This guide
        ├── docs/BUILD_PLAN.md      # Full TDD slices, schemas, tests, contracts
        ├── docs/status.md          # Updated after EVERY delivered slice
        ├── docs/evidence/S#/       # Real red/green/e2e/negative logs, screenshots (if real)
        ├── fixtures/               # Fictional seed inputs and attacker candidates
        ├── policies/               # Versioned synthetic policy examples
        ├── src/coaching_privacy/   # Implemented by agent
        ├── tests/                  # Implemented by agent
        ├── scripts/                # Implemented by agent
        ├── milestone-status.json   # Slice checkpoint state (file name preserved)
        └── artifacts/              # Disposable local work products; required proof lives in docs/evidence/
```

**No nested `.git/` under projects.** OpenClaw should load the monorepo root `AGENTS.md` and explicitly read this project's `AGENTS.md` and `docs/BUILD_PLAN.md`. The Git branch / PR workflow is defined by the monorepo root `AGENTS.md`; the owner must configure GitHub credentials and repository settings.

## Strict TDD and feature-oriented delivery

The existing v5 technology slices have been replaced with **S0–S7 complete-functional-slice PRs**. Every slice follows **RED → GREEN → REFACTOR → VERIFY → DEMO → PR → VERIFIED MERGE → CONTINUE**. RED means an intentionally failing behavioral assertion captured **before** implementation, not an import error. GREEN means unit/integration/E2E plus privacy-negative and all earlier regressions pass. Every PR must include one runnable end-to-end feature, not merely a standalone component. The final PR head must be green and pass relevant offline checks.

| Slice | Observable functionality at the checkpoint |
|---|---|
| S0 | Fictional text → real Presidio redaction → independent leak check → decision and report |
| S1 | Generate → process → evaluate deterministic fictional sessions |
| S2 | Same transcript sanitized differently for internal analysis vs external sharing |
| S3 | Cross-turn contextual clues flagged using real offline GLiNER and deterministic rules |
| S4 | Cross-session synthetic linkage detected and blocked/reviewed; attack simulator report |
| S5 | Synthetic WAV → real offline transcription → same privacy processing/decision |
| S6 | One-command full audit, demos, acceptance matrix and offline execution proof |
| S7 | Fictional batch processing through production-shaped storage/worker adapters |

## Instructions to OpenClaw
1. Ensure OpenClaw can execute shell commands and edit files in **this repository**, ideally inside an isolated development sandbox.
2. Tell it: **"Read this project's AGENTS.md, README.md, docs/BUILD_PLAN.md and docs/status.md. Implement S0 first with failing TDD tests, make all required tests pass, save proof to docs/evidence/S0/, update docs/status.md, create a feature PR, satisfy CI/review, verify its actual merge, and then automatically continue with S1–S7. Do not pause for routine approvals already satisfied by repository policy."**
3. If the session changes, the agent must read `docs/status.md`, `milestone-status.json`, Git status and evidence before resuming the first unfinished slice. No manual `Proceed` messages are needed for passing slices.
4. GitHub PR delivery is now a required part of the workflow. The monorepo owner must configure a remote, scoped OpenClaw GitHub credentials, branch rulesets and an appropriate CI runner. Do not claim delivery without a verified merged PR. If a permission or review blocks merging, report `BLOCKED` and do not advance dependent slices.

OpenClaw's main agent workspace has its own `AGENTS.md`, so a nested repository file is **not guaranteed to be auto-loaded**. Explicitly instruct it to read this repository file or configure the project as its agent workspace.

## GitHub PR and CI contract (monorepo)

The root `AGENTS.md` defines universal branch/PR/merge rules. This project follows **one end-to-end functional capability per PR** for S0–S7, using feature branches `feature/coaching-privacy-pipeline/S#-<slug>` from `main`. Each PR includes behavioral RED proof, passing real-model tests as required for that slice, end-to-end demo, a privacy-negative test, regression results, and updated `docs/status.md` and `docs/evidence/S#/` before merge.

Root shared GitHub files are `.github/workflows/monorepo-ci.yml`, `.github/scripts/verify_changed_projects.py`, and `.github/pull_request_template.md`. Branch ruleset must require the stable check **`monorepo / verify`**. `scripts/setup.sh`, `test.sh`, `demo.sh`, and `verify.sh` are created during S0. The CI gate fails if any mandatory script or real-model test is missing. For slow/large model inference, assign an approved capable CI runner using the GitHub Actions repository variable `MONOREPO_CI_RUNNER`; do not substitute mock tests.

`docs/status.md` should mark the feature `READY_FOR_MERGE` within its PR; the merge SHA cannot be committed in that same PR before it merges. After merge verification, record that SHA in the next slice PR, or a final documentation closeout PR for S7. GitHub protected branch rules and independent review cannot be bypassed for automation.

## Runtime requirements for CPU PoC
- Python 3.11; Linux x86-64 reference environment; about 8 GB RAM (more helps). Browser/remote development environment is fine; no powerful local computer required. A CPU machine with 16 GB RAM is recommended for GLiNER Medium and audio experiments; 8 GB may work with reduced concurrency.
- Internet permitted only to install dependencies and download explicitly approved open models before local/offline execution.
- Default tests and demo: no GPU, no commercial API key, no real personal information, no always-running VM.
- Chosen models: Presidio (MIT) + spaCy `en_core_web_sm` (MIT) for direct PII; `urchade/gliner_medium-v2.1` (Apache-2.0) for contextual entity spans; deterministic risk rules/transformations; and faster-whisper `small.en` (MIT model card) for optional audio (a smaller model may be used for a short CPU smoke test). No generative LLM or inference API. The full dependency/model license inventory and SBOM are required before commercial deployment. Setup downloads version-pinned artifacts once; runtime and tests work offline. `scripts/setup.sh` must verify model availability and record exact IDs/checksums. Optional GPU benchmarking does not affect CPU acceptance.

## Commands the agent must implement and verify
```bash
bash scripts/setup.sh         # install Python .venv, pinned dependencies, Presidio/spaCy and verified GLiNER files
bash scripts/test.sh          # offline pytest, including mandatory P0 checks
bash scripts/demo.sh          # deterministic end-to-end synthetic demonstration
bash scripts/verify.sh        # validate schemas, gate decisions, traceability, evidence
make test demo verify
```

Optional demonstrations:
```bash
bash scripts/demo_audio_real.sh   # short synthetic speech through real faster-whisper
bash scripts/demo_context_real.sh # actual offline GLiNER span extraction and risk cases (required by S3)
```

**Before the agent implements them, these commands do not exist.** After implementation, replace this section with the exact observed commands, test counts, environment and outcomes. The required CLI entry points are `privacy-fixtures generate`, `privacy-fixtures directory`, `privacy-pipeline process` and `privacy-eval run`.

## Expected demonstration
- Known direct identifiers are detected/redacted by **real Presidio/NLP**.
- Rare multi-turn or multi-session identifying clues trigger review.
- A deliberate post-transformation identifier leak is `BLOCKED`.
- An unavailable critical validator is `FAILED`.
- A benign synthetic internal transcript may be `RELEASE_CANDIDATE` after all applicable checks.
- An external-sharing purpose remains `REVIEW_REQUIRED` pending human approval.
- A closed-world fictional identity-linkage experiment and semantic-preservation measures are reported with denominators and limitations.

## Evidence and cost control
Each feature slice ends with **documented evidence, a green PR, verified merge, and automatic continuation after merge**. Update `docs/status.md` and `milestone-status.json`, and save verified, sanitized RED/GREEN/unit/integration/E2E/negative/regression evidence under `docs/evidence/S#/`. Actual screenshots may be included when available; logs are mandatory, screenshots are not. The final acceptance must include an offline-network-denial test, actual GLiNER execution and license inventory; no real data or production compliance claim is allowed. Keep short-lived model compute off between experiments. Do not present model quality metrics as met before actually benchmarking real model inference. Do not claim paid GPU experiments were run without timestamps, model IDs, versions and measurements. The exact acceptance IDs, output schemas and production migration gates live in `docs/BUILD_PLAN.md`.

## How to inspect progress and proof
- Human-readable progress: [`docs/status.md`](docs/status.md). This is updated after **every** slice with delivered functionality and conformance against its acceptance IDs, including NOT_RUN/FAIL.
- Evidence for slice S#: `docs/evidence/S#/red.log`, `green.log`, `e2e.log`, `negative.log` and `summary.json` (plus regression/offline reports and genuine screenshots where applicable).
- Machine resume state: `milestone-status.json`. Both records must refer to the same execution evidence. A fresh agent session verifies them rather than trusting an assertion.
- The agent may continue automatically only after a genuinely green slice **and a verified merged PR**; if required tests, reviews, permissions or evidence fail, it records a blocker rather than moving forward unsafely.

## What this does **not** guarantee
- Open-source model licensing does not by itself guarantee that processing a coaching session satisfies ICF ethics, privacy law, or a particular organization's confidentiality agreements. Only use **synthetic** input until real-data gates have been formally approved.
- GLiNER predicts explicit entity spans; it cannot discover every novel inference or prove anonymity. Unknown high-risk cases must go to `REVIEW_REQUIRED`, not auto-release.
- `RELEASE_CANDIDATE` is for **synthetic internal tests only**. It is not a public-disclosure approval.

## Links
- [Microsoft Presidio](https://microsoft.github.io/presidio/)
- [GLiNER Medium v2.1 model card (Apache 2.0)](https://huggingface.co/urchade/gliner_medium-v2.1)
- [GLiNER source code](https://github.com/urchade/GLiNER)
- [spaCy English models](https://spacy.io/models/en)
- [Whisper weights and license](https://github.com/openai/whisper)
- [faster-whisper](https://github.com/SYSTRAN/faster-whisper)
- [ICF Code of Ethics](https://coachingfederation.org/credentialing/coaching-ethics/icf-code-of-ethics/)
- [NIST SP 800-188](https://csrc.nist.gov/pubs/sp/800/188/final)
