# postclip-builder

Turns a pinned build of the [`postclip`](../postclip/) web app into iOS and Android apps for the App Store and Google Play. The native shell must stay **non-invasive**: PostClip is a quick "share a screenshot → get clean text" tool, so the native app's job is to make that one flow effortless, not to add screens.

## Project state

**PLAN_ONLY (stub).** This project only records scope, constraints and the contract with `postclip`. It is **not** built, and a detailed plan will be written after `postclip` reaches `COMPLETE` (its S6 produces `docs/BUILDER_HANDOFF.md` and `docs/BUILDER_CONTRACT.md`).

| What | Where |
|---|---|
| Stub plan: scope, architecture direction, prerequisites, risks | [docs/BUILD_PLAN.md](docs/BUILD_PLAN.md) |
| Rules for agents | [AGENTS.md](AGENTS.md) |
| Status ledger | [docs/status.md](docs/status.md) |

## Commands

```bash
bash scripts/setup.sh; bash scripts/test.sh; bash scripts/demo.sh; bash scripts/verify.sh   # each reports PLAN_ONLY honestly; none builds anything yet
```
