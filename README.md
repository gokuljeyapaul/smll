# smll 🧰

> Small, sharp tools that do one useful thing well, privately, on your own device. Each one is built end to end by an autonomous agent and proven with tests, not promises.

## 📸 postclip: screenshot in, clean text out

You screenshot a post. You want the words, not the picture.

- **Share a screenshot to it** (Android share sheet, or embedded in a host app) and your text is already there, with a big **Copy** button first.
- **It reads text inside pictures too**, including images nested inside the screenshot.
- **Private by construction.** The OCR and the optional tidy-up model run in your browser. Nothing is uploaded, nothing is stored, no accounts.
- **Drops into other apps.** Embed it in a mobile app's WebView or iframe, send it an image, and get the text back.
- Copy it, share it, or save it as `.md`, `.txt` or `.json`.

[Try the demo 🎬](projects/postclip/docs/demo/postclip-full-demo.mp4) · [All flows 🎬](projects/postclip/docs/demo/postclip-demo.mp4) · [Project page](projects/postclip/) · [Embedding guide](projects/postclip/docs/INTEGRATION.md)

**Status:** built (rounds 1 and 2). Waiting on the owner to confirm the visual checks. English only.

## 🔒 coaching-privacy-pipeline: share coaching sessions without sharing the people

Coaching conversations are full of names, employers, health details and "wait, I could figure out who that is" clues. This pipeline cleans them up before anyone else sees them.

- **Catches the obvious and the sneaky.** Names, emails and phones, plus combinations of details that point to one person, even across sessions.
- **Works on transcripts and audio.** Audio is transcribed offline first, then goes through the same pipeline.
- **Cleans for a purpose.** What's removed depends on who will read it.
- **Checks its own work.** A separate check looks for leftover leaks, and the answer is one of four: `RELEASE_CANDIDATE`, `REVIEW_REQUIRED`, `BLOCKED`, `FAILED`. When unsure, it blocks.
- **Fully offline.** No cloud, and nothing generative that could invent content.

[Project page](projects/coaching-privacy-pipeline/) · [Status](projects/coaching-privacy-pipeline/docs/status.md)

**Status:** built, release `v0.1.0-poc`. Synthetic data only, and **not** an approved anonymisation or compliance tool.

## 🤖 How they get built

An agent (**Atina**, via the Atina Autobot GitHub App) turns a plan into merged PRs. You say "Continue postclip." and it picks the next issue, writes a failing test first, makes it pass, commits the evidence and opens a PR. Merge needs `monorepo / verify` green, and the proof is posted in the issue.

- One feature = one PR = one demo. RED first, evidence committed, and a claimed PASS means a test ran and passed.
- Stuck means a clean `BLOCKED`, not a workaround.
- The full rules are in [`AGENTS.md`](AGENTS.md).

<details>
<summary>Add a new project, or set up the repo</summary>

**New project**
1. Make `projects/<name>/` with its own `AGENTS.md`, `README.md`, `docs/BUILD_PLAN.md`, `docs/status.md` and real `scripts/{setup,test,demo,verify}.sh`.
2. Generate the work queue: `python3 tools/gen_issues.py --project <name>` (preview; add `--create --repo owner/name` to go live).
3. Tell the agent: "Continue `<name>`."

Never `git init` a second repo in here. One `.git/`, at the root.

**Owner setup (once)**
- Protect `main` with a PR-only ruleset requiring **`monorepo / verify`** (CI is in `.github/workflows/monorepo-ci.yml`).
- Install the Atina Autobot GitHub App on this repo only. It uses short-lived tokens and commits as `atina-autobot[bot]`.
- Optional: enable auto-merge.

**Heavy ML:** real-model gates may need an approved capable runner. They are never quietly mocked, and weights, secrets and real recordings are never committed.

</details>
