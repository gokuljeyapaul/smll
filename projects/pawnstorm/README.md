# pawnstorm

Small language models play chess in your browser: watch two SLMs battle, play one yourself, or get coached by another. **SLM showcase:** plug-and-play models, benchmarked honestly.

Pick a bundled model, paste a Hugging Face GGUF link, load a local file or point it at a model server on your own machine. Every game records exactly which model played it, so tournaments, puzzles and a ratings ladder turn pawnstorm into a reproducible chess benchmark for small models. Runs locally on CPU; no cloud model, no accounts, no tracking.

**Status:** `PLAN_ONLY` — see [`docs/status.md`](docs/status.md).

| What | Where |
|---|---|
| Full plan (modes, plug-and-play models, coach, benchmark rules, acceptance IDs, slices) | [docs/BUILD_PLAN.md](docs/BUILD_PLAN.md) |
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
