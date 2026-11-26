# smll 🛠️🤖

> One repo. Many projects. An agent that builds them while you do literally anything else, and leaves receipts.

A testbed where an autonomous agent (**Atina**, via the Atina Autobot GitHub App) turns a plan into merged PRs, and CI and issue logs prove it actually worked. No "trust me bro" allowed.

```text
 plan ──► issues ──► agent: RED → GREEN → evidence → PR ──► CI ──► merge ──► proof in the issue
  ▲                                                                             │
  └──────────────── you: "Continue <project>." (one line, that's it) ◄──────────┘
```

## What's in here

| Project | The pitch | Status |
|---|---|---|
| 📸 [`postclip`](projects/postclip/) | Screenshot of a post in, clean shareable text out. Real in-browser OCR, offline, zero upload. | **Built**, rounds 1 and 2 (share-first flow, embeddable, model cached once). Waiting on you to confirm the owner-visual checks. [Plan](projects/postclip/docs/BUILD_PLAN.md) · [Conformance](projects/postclip/docs/evidence/S6/conformance_report.md) · [Full demo 🎬](projects/postclip/docs/demo/postclip-full-demo.mp4) · [All flows 🎬](projects/postclip/docs/demo/postclip-demo.mp4) |
| 🔒 [`coaching-privacy-pipeline`](projects/coaching-privacy-pipeline/) | Fully offline, non-generative transcript and audio privacy PoC. | Planned. Hasn't started. [Plan](projects/coaching-privacy-pipeline/docs/BUILD_PLAN.md) |

## The rules of the game

- **One feature = one PR = one demo.** No lonely utilities that do nothing.
- **RED first.** A test must fail for the *right* reason before any code gets written.
- **Evidence is committed**, sanitized and honest, in `projects/<name>/docs/evidence/<slice>/`. A claimed PASS means a test ran and passed.
- **`monorepo / verify` must be green** to merge. No bypasses, no heroics.
- **Stuck? Say so.** A clean `BLOCKED` beats a clever workaround.

Full rulebook: [`AGENTS.md`](AGENTS.md). Each project adds its own.

## Start a new project

1. Make `projects/<name>/` with its own `AGENTS.md`, `README.md`, `docs/BUILD_PLAN.md`, `docs/status.md`, and real `scripts/{setup,test,demo,verify}.sh`.
2. Generate the work queue from the plan: `python3 tools/gen_issues.py --project <name>` (previews only; add `--create --repo owner/name` to go live).
3. Tell the agent: **"Continue `<name>`."**

Never `git init` a second repo in here. It's one `.git/`, at the root, and it likes it that way.

## Owner setup (once)

- Protect `main` with a PR-only ruleset and require the check **`monorepo / verify`** (CI lives in `.github/workflows/monorepo-ci.yml`).
- Install the **Atina Autobot** GitHub App on this repo only. It uses short-lived tokens, no stored PATs, and commits as `atina-autobot[bot]`.
- Optional: enable auto-merge.

## Heads-up on heavy ML

Real-model gates may outgrow a normal hosted runner. When that happens they run on an approved capable runner or stay blocked. They are never quietly mocked. Model weights, secrets and real recordings never get committed.

Merge SHAs are recorded *after* merge (in the next PR's status update), never guessed in advance.
