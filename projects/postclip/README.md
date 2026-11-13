# postclip

Screenshot of a post in, clean shareable text out — entirely on your phone.

1. Pick (or share, paste, or accept the latest) screenshot of a LinkedIn-style post.
2. On-device OCR reads it; a small local LLM tidies it up (removes buttons/UI, fixes line breaks).
3. You review and edit.
4. Share it to Telegram or any app, or export it as `.md` / `.txt` / `.json`.

No cloud, no accounts, nothing stored. English only (v1). iOS and Android via Expo (dev client).

## Project state

**PLAN_ONLY.** This folder currently contains the specification and the verification tooling; the app is **not built yet**. Nothing here claims a working app.

| What | Where |
|---|---|
| Full plan (use cases, acceptance IDs, slices S0–S6 + D0–D3, test strategy) | [docs/BUILD_PLAN.md](docs/BUILD_PLAN.md) |
| Operating rules for the building agent | [AGENTS.md](AGENTS.md) |
| Ledger of delivered slices | [docs/status.md](docs/status.md) |
| One-shot prompt for Hermes (Stage L, Linux) | [docs/HERMES_PROMPT.md](docs/HERMES_PROMPT.md) |
| How the device stage (Mac, with Claude Code) works | [docs/STAGE_D.md](docs/STAGE_D.md) |

## How it gets built

1. **Stage L — Hermes on openclawlaunch (Linux), autonomous:** all code, fixtures, tests, host-side LLM evaluation. Device-dependent checks stay `NOT_RUN`.
2. **Stage D — owner + Claude Code on a Mac:** builds both apps, runs every flow on iOS simulator and Android emulator, records video, re-evaluates on real OCR output, final conformance.

## Commands

```bash
bash scripts/preflight.sh        # prerequisite check (auto: Linux = Stage L, macOS = Stage D); BLOCKED if a required tool is missing
bash scripts/setup.sh            # preflight + npm ci (once the app exists)
bash scripts/test.sh             # tool self-tests; Jest, typecheck, lint once the app exists
bash scripts/demo.sh             # PLAN_ONLY: NOT_RUN; Stage L: host demo; Stage D on a Mac: the real device flows
bash scripts/verify.sh           # plan lint + evidence integrity (CI-safe)
bash scripts/verify.sh --device  # Stage D on the Mac only: also the full device suite
make test demo verify
```

## Why the evidence is trustworthy (by design)

- `scripts/plan_lint.py` keeps the plan internally consistent (every use case has an acceptance ID, a test path, and a slice).
- `scripts/verify_evidence.py` rejects any `PASS` that is not backed by a committed, passing JUnit testcase for each required platform, any evidence produced from different code than the current tree, and any acceptance ID left unaccounted for at the end.
- Videos are recordings of *passing* Maestro flows, listed in a hashed manifest.

Synthetic data only. A passing suite does not prove accuracy on arbitrary real screenshots, real-device LLM speed, or delivery into third-party apps — those are reported as `PARTIAL` / `NOT_RUN` where they are not tested.
