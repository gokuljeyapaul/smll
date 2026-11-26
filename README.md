# smll 🧰✨

> Tiny tools with big opinions about your privacy. Built by an AI agent that has to show its receipts before anything merges.

**Your screenshots stay on your phone. Your coaching clients stay anonymous. Your trust stays un-"trust me bro"-ed.** Everything here runs on your own device, and every claim is backed by a test that actually ran.

## 🎯 The lineup

| Project | The pitch | The vibe check |
|---|---|---|
| 📸 [**postclip**](projects/postclip/) | You screenshot a post. It hands you the *words*. Share the image in, get clean copy-ready text out, including text hiding inside the images inside the screenshot. 🕵️<br><br>[![postclip: screenshot in, clean text out](assets/postclip-demo.gif)](projects/postclip/docs/demo/postclip-full-demo.mp4) | ✅ **Built.** Offline, zero uploads, no accounts, embeddable in your app. Big **Copy** button first, because we respect your thumb. [Demo 🎬](projects/postclip/docs/demo/postclip-full-demo.mp4) · [Every flow 🎬](projects/postclip/docs/demo/postclip-demo.mp4) · [Embed it](projects/postclip/docs/INTEGRATION.md) |
| 🔒 [**coaching-privacy-pipeline**](projects/coaching-privacy-pipeline/) | Coaching sessions are packed with names, employers and "wait, I could work out who that is" clues. This scrubs them, then **audits itself** and blocks when it isn't sure. 🙈 | ✅ **Built** (`v0.1.0-poc`). Transcripts *and* audio, fully offline, nothing generative to make stuff up. Synthetic data only, and *not* a compliance stamp. [Status](projects/coaching-privacy-pipeline/docs/status.md) |

More coming. The agent doesn't sleep. 😴❌

## 🤖 Wait, an agent builds these?

Yep. **Atina** reads a plan, writes a test that *fails first* (on purpose, for the right reason), makes it pass, commits the evidence and opens a PR. You type one line:

```text
 "Continue postclip."  ──►  issue ──► RED ──► GREEN ──► evidence ──► PR ──► CI ✅ ──► merged ──► proof posted
```

- **One feature = one PR = one demo.** No lonely utilities that do nothing.
- **PASS means a test ran and passed.** Not "felt right". Not "probably".
- **Stuck? It says `BLOCKED`.** It does not get creative with your repo.
- Rulebook: [`AGENTS.md`](AGENTS.md).

<details>
<summary>🛠️ Add a project / set up the repo</summary>

**New project**
1. Make `projects/<name>/` with its own `AGENTS.md`, `README.md`, `docs/BUILD_PLAN.md`, `docs/status.md` and real `scripts/{setup,test,demo,verify}.sh`.
2. Generate the work queue: `python3 tools/gen_issues.py --project <name>` (preview; add `--create --repo owner/name` to go live).
3. Tell the agent: "Continue `<name>`."

One `.git/`, at the root. Never `git init` a second repo in here.

**Owner setup (once)**
- Protect `main` with a PR-only ruleset requiring **`monorepo / verify`** (CI is in `.github/workflows/monorepo-ci.yml`).
- Install the Atina Autobot GitHub App on this repo only. Short-lived tokens, commits as `atina-autobot[bot]`.
- Optional: enable auto-merge.

**Heavy ML:** real-model gates may need an approved capable runner. They are never quietly mocked, and weights, secrets and real recordings are never committed.

</details>
