# Runner: Hermes (Linux container, model via Ollama Cloud)

- **Builder vs product.** Hermes may use its Ollama Cloud coding model to *write* this project. The *product* must never call Ollama Cloud or any hosted model: shipped inference is local CPU only with the models pinned in `scripts/model_manifest.json`.
- **Machine.** Linux expected. `bash scripts/preflight.sh build` records OS, cores, RAM and disk; if they are below the plan's budget, report `BLOCKED` with the numbers. Do not improvise a Windows port.
- **Installs.** Project-local `.venv` + pip, Playwright Chromium, and only the system packages the plan's D-table "Installs" names.
- **Network.** Full outbound assumed for setup (PyPI, Hugging Face, the plan's data sources). Processing after fetch must work offline.
- **Secrets.** Owner-provided credentials for `live` rows come from environment variables or the OS keyring; never write them to files in the repo, logs or evidence.
- **GitHub.** `gh` CLI. Create PR: `gh pr create --base main --head <branch> --title ... --body-file ...` (use `.github/pull_request_template.md`). Checks: `gh pr checks <n>`. Merge: `gh pr merge <n> --squash` after checks are green; verify with `gh pr view <n> --json state,mergeCommit`.
- **Long commands.** Write long suites and model benches to log files under `artifacts/` and copy sanitized excerpts into `docs/evidence/<slice>/`.
- **Sessions.** Resume from `docs/status.md`, `milestone-status.json` and the evidence folder, never from remembered chat state.
