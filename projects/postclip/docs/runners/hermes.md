# Runner: Hermes (openclawlaunch, Linux container)

- **Machine:** expected to be a Linux container (not confirmed for every openclawlaunch plan). `scripts/preflight.sh build` checks the OS: this plan needs a Linux or macOS shell (bash, `apt-get` for the D6 installs). If the OS is Windows, use WSL2 if available; otherwise stop and report `BLOCKED` with the detected OS (`uname -a` / the OS name) and ask the owner. Do not improvise a Windows port.
- **Size:** depends on the openclawlaunch plan (observed range ~1–2 vCPU, 2–4 GB RAM). `scripts/preflight.sh build` records the real numbers; if Chromium + WebKit + the model do not fit, report `BLOCKED` with those numbers (plan risk table).
- **Installs:** root, `apt-get` allowed for exactly what plan D6 lists (ffmpeg, Playwright system dependencies), plus Playwright Chromium/WebKit and project-local `npm ci`.
- **Network:** full outbound access is assumed. `scripts/preflight.sh build` still verifies that npm, Hugging Face and the Playwright CDN are reachable.
- **GitHub:** the standard `gh` CLI works, including `gh pr` and `gh issue` (GraphQL is available).
  - Create PR: `gh pr create --base main --head <branch> --title ... --body-file ...` (use `.github/pull_request_template.md`).
  - Checks: `gh pr checks <n>`; merge: `gh pr merge <n> --squash` after the checks are green (if the owner has enabled "Allow auto-merge" in the repo settings you may instead queue it with `gh pr merge <n> --auto --squash` and verify it merged); verify: `gh pr view <n> --json state,mergeCommit`.
- **Long commands:** no special limit known; still write long suites to a log file.
- **Skills:** the owner keeps reusable skills in the private repo `gokuljeyapaul/atina-skills`. Clone it and run `bash install.sh --link` (or `--target <your skills dir>`); Hermes' skills live in `~/.hermes/skills/` as folders with a `SKILL.md`. Skills describe how to work; this project's files say what to build and win on any conflict.
- **Sessions:** resume from `docs/status.md`, `milestone-status.json` and the evidence folder, never from remembered chat state.
