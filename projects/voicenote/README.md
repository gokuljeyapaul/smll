# voicenote

Voice notes in English and Indian languages → to-dos and calendar. **SLM showcase:** Indic speech + extraction on CPU.

Voice notes in English and Indian languages (incl. code-mixed speech) become transcripts, summaries and dated to-dos, reviewed and exported as .ics/JSON/Markdown or shared as text. Indic-specialised open-weight speech and language models run locally on CPU.

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
