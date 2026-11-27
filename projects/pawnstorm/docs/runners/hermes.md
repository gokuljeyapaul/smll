# Runner: Hermes (Linux container, model via Ollama Cloud)

- **Builder vs product.** Hermes may use its Ollama Cloud coding model to *write* this project. The *product* must never call Ollama Cloud or any hosted model: shipped inference is local CPU only (in the browser, or a loopback/LAN model server) with the presets pinned in `scripts/model_manifest.json`.
- **Machine.** Linux expected. `bash scripts/preflight.sh build` records OS, cores, RAM and disk; if they are below the plan's budget, report `BLOCKED` with the numbers. Do not improvise a Windows port.
- **Installs.** `npm ci` in the project folder (lockfile committed), Playwright Chromium (`npx playwright install chromium`), and for `bench` only a reference engine on the host (plan D12). No global npm installs, no system packages beyond the plan.
- **Network.** Full outbound assumed for setup (npm registry, Hugging Face, Playwright downloads). Play and benchmarks after model caching must work offline.
- **Browser isolation.** Multi-threaded WASM needs COOP/COEP headers; the dev/preview server and the arena runner must send them. Record whether threads were available in each run's metadata.
- **GitHub.** `gh` CLI. Create PR: `gh pr create --base main --head <branch> --title ... --body-file ...` (use `.github/pull_request_template.md`). Checks: `gh pr checks <n>`. Merge: `gh pr merge <n> --squash` after checks are green; verify with `gh pr view <n> --json state,mergeCommit`.
- **Long commands.** Tournaments and benches run for a long time: write them to log files under `artifacts/` (gitignored), poll the log, and copy sanitized excerpts and result JSON into `docs/evidence/<slice>/`.
- **Sessions.** Resume from `docs/status.md`, `milestone-status.json` and the evidence folder, never from remembered chat state.
