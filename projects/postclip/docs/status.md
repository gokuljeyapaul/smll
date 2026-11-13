# postclip — delivery status and evidence ledger

## Current status

- **Phase:** `PLAN_ONLY` — specification and verification tooling only. **No app code, no device tests, no video, no model evidence exists.**
- **Active slice:** none
- **Overall engineering result:** `NOT_STARTED`
- **Owner decisions:** D1 CI strategy = `split_with_root_exception` (decided; recorded in `milestone-status.json` and the root `AGENTS.md`). No open decisions.
- **Next required action:** run the building agent with `docs/HERMES_PROMPT.md` after the plan PR is merged; start with S0.

## Slice overview

| Slice | Observable result | Status | PR / merge | Evidence |
|---|---|---|---|---|
| S0 | Pick screenshot → OCR → review → share (both platforms) | NOT_STARTED | — | — |
| S1 | Edit, export, language gate, clear errors, no-storage audit v1 | NOT_STARTED | — | — |
| S2 | Share-in, paste, offer-latest, permission handling | NOT_STARTED | — | — |
| S3 | Model download/verify/offline, OCR-only fallback | NOT_STARTED | — | — |
| S4 | Local LLM cleanup with safety guards (model selected by measurement) | NOT_STARTED | — | — |
| S5 | Hardening, large inputs, accessibility, Release build | NOT_STARTED | — | — |
| S6 | Conformance report and full-use-case videos | NOT_STARTED | — | — |

## Acceptance traceability

All 31 acceptance IDs (A01–A31) are defined in `docs/BUILD_PLAN.md` with status `NOT_RUN`. This table is replaced by real per-ID statuses, backed by JUnit testcases, as slices are delivered (`scripts/verify_evidence.py` enforces the link).

## Known limitations (planned, not yet measured)

- Simulator/emulator results do not represent real-device LLM speed or memory (A30 `NOT_RUN` unless a device is attached).
- iOS share-extension automation, simulator clipboard-image seeding, and Telegram delivery may end `PARTIAL` / `NOT_RUN`; the plan requires each to be verified, not assumed.
- Synthetic fixtures do not establish accuracy on arbitrary real screenshots.
