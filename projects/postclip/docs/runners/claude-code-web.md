# Runner: Claude Code on the web (claude.ai/code cloud session)

Facts below come from the Claude Code on the web docs (code.claude.com/docs/en/cloud-environments, claude-code-on-the-web). Items marked **UNCONFIRMED** must be verified by the smoke test at the end before slice S0 is started.

## Machine
- Fresh Ubuntu 24.04 x86_64 VM per session, approx. 4 vCPU / 16 GB RAM / 30 GB disk. Root, `apt` works. Preinstalled: Node 20/21/22, Python 3, uv, `gh`, Chrome for Testing, Docker.
- If the toolchain needs a Node newer than the preinstalled one, report `BLOCKED` (plan D1) instead of improvising.

## Environment configuration (owner sets once, in the environment dialog)
- **Network access:** *Limited* with "Allow package managers" **plus these allowed domains**: `cdn.playwright.dev`, `playwright.download.prss.microsoft.com`, `huggingface.co`, `*.huggingface.co`, `*.hf.co`. (The default allowlist covers npm, PyPI, github.com and Ubuntu apt but **not** the Playwright CDN or Hugging Face. If the install error names another host, add it.) Alternative: *Full*.
- **Setup script** (runs as root before the session, cached if it finishes in about 5 minutes; keep it short):
  ```bash
  apt-get update && apt-get install -y ffmpeg
  ```
  Playwright system dependencies and browsers are installed by `scripts/setup.sh` / `npx playwright install --with-deps chromium webkit` inside the session (plan D6 scope).
- **Secrets:** none needed. GitHub access is provided by the platform's GitHub proxy.

## Mechanics that differ from a normal shell
- **`gh pr` and `gh issue` do not work** (the proxy rejects GraphQL, HTTP 403). Use REST through `gh api`:
  - Create PR: `gh api repos/gokuljeyapaul/smll/pulls -f title='...' -f head='<branch>' -f base=main -F body=@<body-file>` (body from `.github/pull_request_template.md`, filled in honestly).
  - Checks on the PR head: `gh api repos/gokuljeyapaul/smll/commits/<head-sha>/check-runs --jq '.check_runs[] | [.name,.status,.conclusion] | @tsv'` — need `verify  completed  success`.
  - Wait for the check: poll the check-runs call above (every ~30 s, in the background) until `verify` is `completed success`; then merge. GitHub's auto-merge needs GraphQL, which this proxy blocks, so do not rely on it here.
  - Merge (only under the AGENTS.md merge policy; do not wait for the owner once the gates hold): `gh api -X PUT repos/gokuljeyapaul/smll/pulls/<n>/merge -f merge_method=squash -f sha=<head-sha>`.
  - Verify: `gh api repos/gokuljeyapaul/smll/pulls/<n> --jq '[.merged,.merge_commit_sha]|@tsv'`.
  - Comment: `gh api repos/gokuljeyapaul/smll/issues/<n>/comments -f body='...'`.
- If creating or merging a PR is refused (403/422, not allowed by the proxy or protection), do **not** work around it: stop, report the slice as `READY_FOR_MERGE` with the PR URL and the exact error, and wait for the owner. **UNCONFIRMED** whether merging is permitted from a cloud session.
- **Command time limits:** a shell command defaults to 2 minutes and can request up to 10; longer ones move to the background. Run full suites in the background writing to a log file (`nohup ... > artifacts/run.log 2>&1 &`) and poll the log. An idle VM pauses and may be reclaimed (background processes are lost, the conversation is kept): make every step resumable.
- **One slice per session.** Context compaction happens automatically; after it or after a new session, resume from `docs/status.md`, `milestone-status.json` and `docs/evidence/`, not from memory. Sessions are independent: the owner starts the next slice's session (there is no built-in queue).
- **Skills:** not needed here; the rules are in `AGENTS.md` (loaded through `CLAUDE.md`). The same practices are in the owner's `atina-skills` repo if you want them.
- **Instruction loading:** the repo has `CLAUDE.md` files that import `AGENTS.md`; read `AGENTS.md` explicitly anyway.

## Smoke test before S0 (owner or the agent; costs minutes)
1. `bash scripts/preflight.sh build` — reachability of npm, Hugging Face, Playwright CDN passes.
2. `npx playwright install --with-deps chromium webkit` — both launch headless (UNCONFIRMED on this image).
3. `ffmpeg -version` after the setup script.
4. On a throwaway branch: create a PR via `gh api`, read its check-runs, try the merge call on a docs-only trivial change, record what is allowed. Put the result in the S0 evidence `versions.json`/notes.
