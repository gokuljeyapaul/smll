# inboxpilot

Local email triage, summaries and approved drafts — never sends. **SLM showcase:** Safe tool-calling agent over untrusted input.

A local email assistant that fetches mail over IMAP/Gmail/.mbox and uses a small tool-calling model on CPU to triage, summarise, extract deadlines and draft replies in the sender's language; every mailbox effect waits for approval and it can never send email.

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
