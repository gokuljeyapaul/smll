# postclip — delivery status and evidence ledger

## Current status

- **Phase:** `PLAN_ONLY` — specification and verification tooling only. **No app code, no tests of the app, no video, no model evidence exists.**
- **Active slice:** none
- **Overall engineering result:** `NOT_STARTED`
- **Owner decisions:** CI needs no exception (real Playwright + OCR + model run on `ubuntu-latest`); LLM is progressive. No open decisions.
- **Next required action:** after the plan PR is merged, the owner starts the building agent (Hermes or Claude Code on the web; see `docs/runners/`) to build S0–S6.

## Slice overview

| Slice | Observable result | Status | PR / merge | Evidence |
|---|---|---|---|---|
| S0 | Pick screenshot → real browser OCR → review → share/copy (Chromium + WebKit) | NOT_STARTED | — | — |
| S1 | Cleanup, edit, export, English gate, clear errors, no-storage audit v1 | NOT_STARTED | — | — |
| S2 | Paste, share-target, installable/offline shell | NOT_STARTED | — | — |
| S3 | Model manager: pinned download, checksum, cache, fallback, offline | NOT_STARTED | — | — |
| S4 | Local LLM cleanup with safety guards (runtime/model chosen by measurement) | NOT_STARTED | — | — |
| S5 | Hardening, accessibility, production build checks | NOT_STARTED | — | — |
| S6 | Conformance, videos, compilation video | NOT_STARTED | — | — |

## Acceptance traceability

All 31 acceptance IDs (A01–A31) are defined in `docs/BUILD_PLAN.md` with status `NOT_RUN`. This table is replaced by real per-ID statuses, backed by JUnit testcases, as slices are delivered (`scripts/verify_evidence.py` enforces the link).

## Known limitations (planned, not yet measured)

- WebKit on Linux is not real iOS Safari; real-device behavior (share sheet, installed-PWA share target, clipboard, LLM speed) is `NOT_RUN` unless the optional device pass happens (A27/A30).
- WebGPU cannot be verified on the Linux host; only the WASM path is.
- iOS share-in from other apps is not possible in a plain web app; native app wrapping is out of scope for this project.
- Synthetic fixtures do not establish accuracy on arbitrary real screenshots.
