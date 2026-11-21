# OpenClaw Projects — Single GitHub Monorepo

One GitHub repository (`.git/` only at this root) for multiple independent projects under `projects/`. OpenClaw reads this root `AGENTS.md`, then the active project's instructions.

## Project index

| Project | Description | Delivery plan |
|---|---|---|
| [`coaching-privacy-pipeline`](projects/coaching-privacy-pipeline/) | Fully offline, non-generative transcript and audio privacy PoC | [`BUILD_PLAN.md`](projects/coaching-privacy-pipeline/docs/BUILD_PLAN.md) |

## Initial GitHub repository bootstrap (owner/operator)

1. Put these files at the **GitHub repository root**. Do not put this monorepo inside a second project repository.
2. Ensure the repository contains root `AGENTS.md`, `.github/workflows/monorepo-ci.yml`, `.github/scripts/verify_changed_projects.py`, and `.github/pull_request_template.md`.
3. Enable pull-request-based branch rules on `main` (or the designated integration branch); configure stable required status check **`monorepo / verify`**, required reviews if desired, and auto-merge if desired. The GitHub UI/organization settings cannot be declared by the build plan itself.
4. Grant OpenClaw scoped GitHub access to this **one** repository. Use its workspace instructions to tell it where this clone is and to read this root `AGENTS.md`.
5. Have OpenClaw start Slice S0 in `projects/coaching-privacy-pipeline/`, implementing its required scripts and real TDD functionality in the first feature PR. Until that implementation exists, missing scripts should cause CI to fail rather than show false success.

See `AGENTS.md` for monorepo-wide PR policy. For a new project, add a directory under `projects/` with its own instructions, test scripts and evidence ledger; do not create another Git repository.

## Agent access

This repository is worked on by an agent through the **Atina Autobot** GitHub App (bot account `atina-autobot[bot]`), installed on the `gokuljeyapaul` account with access to all of its repositories. The agent authenticates with short-lived installation access tokens — no personal access tokens are stored — so its pushes, PRs and merges are attributed to `atina-autobot[bot]`. Commits use the bot identity `atina-autobot[bot] <359380225+atina-autobot[bot]@users.noreply.github.com>`.

This documents bootstrap step 4 (agent GitHub access) for the owner-authorized connection verified through this PR. Functional changes continue to follow the slice process in [`AGENTS.md`](AGENTS.md).

## Evidence and merge semantics

Each project maintains `docs/status.md` and actual sanitized test logs in `docs/evidence/<slice>/`. The PR contains evidence **before** merge. GitHub provides actual CI and merge-state evidence. A merge SHA is only available after merge and is recorded in the next PR or final status closeout PR; never prepopulate it.

Heavy offline ML execution may exceed ordinary hosted-runner resources. Required real-model gates must run on an approved capable runner or remain blocked; they cannot be silently mocked. Never commit model weights, credentials, real coaching data or raw recordings.
