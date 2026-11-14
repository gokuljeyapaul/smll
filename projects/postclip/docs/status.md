# postclip — delivery status and evidence ledger

## Current status

- **Phase:** `PLAN_ONLY` — specification and verification tooling only. **No app code, no tests of the app, no video, no model evidence exists.**
- **Active slice:** none
- **Overall engineering result:** `NOT_STARTED`
- **Owner decisions:** CI needs no exception (real Playwright + OCR + model run on `ubuntu-latest`); LLM is progressive; `postclip-builder` is a separate project in this monorepo (plan only, later). No open decisions.
- **Next required action:** after the plan PR is merged, run Hermes (openclawlaunch, Linux) with `docs/HERMES_PROMPT.md` to build S0–S6.

## Slice overview

| Slice | Observable result | Status | PR / merge | Evidence |
|---|---|---|---|---|
| S0 | Pick screenshot → real browser OCR → review → share/copy (Chromium + WebKit) | NOT_STARTED | — | — |
| S1 | Cleanup, edit, export, English gate, clear errors, no-storage audit v1 | NOT_STARTED | — | — |
| S2 | Paste, share-target, installable/offline shell, host bridge | NOT_STARTED | — | — |
| S3 | Model manager: pinned download, checksum, cache, fallback, offline | NOT_STARTED | — | — |
| S4 | Local LLM cleanup with safety guards (runtime/model chosen by measurement) | NOT_STARTED | — | — |
| S5 | Hardening, accessibility, production build checks | NOT_STARTED | — | — |
| S6 | Conformance, videos, compilation video, builder handoff | NOT_STARTED | — | — |

## Acceptance traceability

All 32 acceptance IDs (A01–A32) are defined in `docs/BUILD_PLAN.md` with status `NOT_RUN`. This table is replaced by real per-ID statuses, backed by JUnit testcases, as slices are delivered (`scripts/verify_evidence.py` enforces the link).

## Known limitations (planned, not yet measured)

- WebKit on Linux is not real iOS Safari; real-device behavior (share sheet, installed-PWA share target, clipboard, LLM speed) is `NOT_RUN` unless the optional device pass happens (A27/A30).
- WebGPU cannot be verified on the Linux host; only the WASM path is.
- iOS share-in from other apps is a `postclip-builder` feature, not a web-app feature.
- Synthetic fixtures do not establish accuracy on arbitrary real screenshots.
