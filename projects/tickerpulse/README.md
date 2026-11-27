# tickerpulse

Stock signals from news and social sentiment, read by a local small model. **SLM showcase:** Market sentiment → explained Buy/Hold/Sell.

A local, CPU-only research app that fetches news, filings, social posts and prices for a watchlist, has a small open-weight model read every item into structured signals, and produces explained, backtested Buy/Hold/Sell signals per ticker for configurable markets. Paper trading only; not financial advice.

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
