# postclip — delivery status and evidence ledger

## Current status

- **Phase:** `PLAN_ONLY` — specification and verification tooling only. **No app code, no device tests, no video, no model evidence exists.**
- **Active slice:** none
- **Overall engineering result:** `NOT_STARTED`
- **Owner decisions:** D1 CI strategy = `split_with_root_exception` (decided; recorded in `milestone-status.json` and the root `AGENTS.md`). No open decisions.
- **Next required action:** after the plan PR is merged, run Hermes (openclawlaunch, Linux) with `docs/HERMES_PROMPT.md` for Stage L (S0–S6). Stage D (D0–D3) is done later with Claude Code on the owner's Mac, after Xcode and the Android SDK are installed.

## Slice overview

| Slice | Observable result | Status | PR / merge | Evidence |
|---|---|---|---|---|
| S0 | Pick screenshot → OCR → review → share (both platforms) | NOT_STARTED | — | — |
| S1 | Edit, export, language gate, clear errors, no-storage audit v1 | NOT_STARTED | — | — |
| S2 | Share-in, paste, offer-latest, permission handling | NOT_STARTED | — | — |
| S3 | Model download/verify/offline, OCR-only fallback | NOT_STARTED | — | — |
| S4 | Local LLM cleanup with safety guards (model selected by measurement) | NOT_STARTED | — | — |
| S5 | Hardening, large inputs, accessibility, Release build | NOT_STARTED | — | — |
| S6 | Host conformance (deps/licenses, audits) + Stage D handoff | NOT_STARTED | — | — |
| D0 | Tier 1 device bring-up: build, pick/OCR/review/share, model download + fallback, on-device LLM, no-storage audit (Mac) | NOT_STARTED | — | — |
| D1 | Tier 2 time-boxed: edit/export/errors, Android share-in, offer-latest, permissions, offline, budgets, a11y, Release smoke | NOT_STARTED | — | — |
| D2 | Tier 3 attempts: iOS share extension, clipboard image, Telegram, real device | NOT_STARTED | — | — |
| D3 | Final conformance: real-OCR re-evaluation, videos, verifier-clean summary | NOT_STARTED | — | — |

## Acceptance traceability

All 32 acceptance IDs (A01–A32) are defined in `docs/BUILD_PLAN.md` with status `NOT_RUN`. This table is replaced by real per-ID statuses, backed by JUnit testcases, as slices are delivered (`scripts/verify_evidence.py` enforces the link).

## Known limitations (planned, not yet measured)

- Simulator/emulator results do not represent real-device LLM speed or memory (A30 `NOT_RUN` unless a device is attached).
- iOS share-extension automation, simulator clipboard-image seeding, and Telegram delivery may end `PARTIAL` / `NOT_RUN`; the plan requires each to be verified, not assumed.
- Synthetic fixtures do not establish accuracy on arbitrary real screenshots.
