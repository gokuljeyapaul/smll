# Runner: Hermes (openclawlaunch, Linux container)

- **Machine:** a Linux container; size depends on the openclawlaunch plan (observed range ~1–2 vCPU, 2–4 GB RAM). `scripts/preflight.sh build` records the real numbers; if Chromium + WebKit + the model do not fit, report `BLOCKED` with those numbers (plan risk table).
- **Installs:** root, `apt-get` allowed for exactly what plan D6 lists (ffmpeg, Playwright system dependencies), plus Playwright Chromium/WebKit and project-local `npm ci`.
- **Network:** full outbound access is assumed. `scripts/preflight.sh build` still verifies that npm, Hugging Face and the Playwright CDN are reachable.
- **GitHub:** the standard `gh` CLI works, including `gh pr` and `gh issue` (GraphQL is available).
  - Create PR: `gh pr create --base main --head <branch> --title ... --body-file ...` (use `.github/pull_request_template.md`).
  - Checks: `gh pr checks <n>`; merge: `gh pr merge <n> --squash`; verify: `gh pr view <n> --json state,mergeCommit`.
- **Long commands:** no special limit known; still write long suites to a log file.
- **Skills:** the owner keeps reusable skills in the private repo `gokuljeyapaul/atina-skills`. Clone it and run `bash install.sh --link` (or `--target <your skills dir>`); Hermes' skills live in `~/.hermes/skills/` as folders with a `SKILL.md`. Skills describe how to work; this project's files say what to build and win on any conflict.
- **Sessions:** resume from `docs/status.md`, `milestone-status.json` and the evidence folder, never from remembered chat state.
