# folderchat

Cited answers from your folders and Google Drive. **SLM showcase:** Grounded Q&A with verifiable citations.

Ask questions of local folders and Google Drive (incl. shared files and shared drives, read-only) and get answers that quote and cite the exact passage or say "not found"; share answers as text with links to the source docs. A citation-native small model runs locally on CPU.

**Status:** `PLAN_ONLY` — see [`docs/status.md`](docs/status.md).

| What | Where |
|---|---|
| Full plan (use cases, model candidates, acceptance IDs, slices) | [docs/BUILD_PLAN.md](docs/BUILD_PLAN.md) |
| Operating rules for the building agent | [AGENTS.md](AGENTS.md) |
| Ledger | [docs/status.md](docs/status.md) |
| Runner mechanics | [docs/runners/](docs/runners/) |

## Commands (plan phase)

```bash
bash scripts/preflight.sh   # prerequisites (ci mode while PLAN_ONLY)
bash scripts/test.sh        # plan linter self-test + plan lint + work-queue parse
bash scripts/demo.sh        # preview of the slice issues the agent will work through
bash scripts/verify.sh      # plan lint + ledger honesty
```

S0 replaces these with the real setup/test/demo/verify (the plan-only scripts refuse to run once the phase is `BUILDING`).
