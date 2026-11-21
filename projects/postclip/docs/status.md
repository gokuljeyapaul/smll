# postclip — delivery status and evidence ledger

## Current status

- **Phase:** `BUILDING` (S0 delivered; slices S1–S6 pending)
- **Active slice:** S0 — Foundations: pick a screenshot, read it, review, share or copy. `READY_FOR_MERGE` (PR opened by the building agent; the merge SHA is recorded in the next slice's update, per repo convention).
- **Overall engineering result:** S0 acceptance proven (A01, A02, A03, A20, A25, A31 all PASS with committed JUnit evidence in both required engines); overall `IN_PROGRESS` (6 of 7 slices remaining).
- **Owner decisions:** CI needs no exception (real Playwright + OCR runs on `ubuntu-latest`); LLM is progressive; OCR engine chosen by measurement (tesseract.js 7 + `4.0.0_fast`, see `docs/evidence/S0/ocr_engine_comparison.md`).
- **Next required action:** merge S0 (owner reviews the PR), then S1 — Cleanup, edit, export, language gate, errors, no-storage v1 (issue #54).

## Slice overview

| Slice | Observable result | Status | PR / merge | Evidence |
|---|---|---|---|---|
| S0 | Pick screenshot → real browser OCR (tesseract.js in a Worker, both engines) → review → share (spied) / copy (real clipboard verification) | READY_FOR_MERGE | PR: see `milestone-status.json` / issue #53 | `docs/evidence/S0/` (red.log, green.log, e2e.log, negative.log, demo.log, summary.json, junit/, versions.json, ocr_engine_comparison.md, runner-smoke.md, owner/) |
| S1 | Cleanup, edit, export, English gate, clear errors, no-storage audit v1 | NOT_STARTED | — | — |
| S2 | Paste, share-target, installable/offline shell | NOT_STARTED | — | — |
| S3 | Model manager: pinned download, checksum, cache, fallback, offline | NOT_STARTED | — | — |
| S4 | Local LLM cleanup with safety guards (runtime/model chosen by measurement) | NOT_STARTED | — | — |
| S5 | Hardening, accessibility, production build checks | NOT_STARTED | — | — |
| S6 | Conformance, videos, compilation video | NOT_STARTED | — | — |

## Acceptance traceability

Per-ID statuses live in each slice's `docs/evidence/<slice>/summary.json` (JUnit-linked; `scripts/verify_evidence.py` enforces). S0 delivered:

| ID | Status | Proof (see `docs/evidence/S0/summary.json` for exact refs) |
|---|---|---|
| A01 | PASS | a01 smoke in chromium-e2e.xml + webkit-e2e.xml; videos a01_smoke_* |
| A02 | PASS | uc01 flow in both engines; real in-browser OCR on fixtures |
| A03 | PASS | uc01 flow: navigator.share spy payload + real clipboard verification (chromium read; webkit paste round-trip — platform cannot grant clipboard permissions, see runner-smoke.md) |
| A20 | PASS | eval_ocr_cer_clean_set in both engines: clean-set mean CER 1.33% (bar ≤ 5%); engine selection measured in ocr_engine_comparison.md |
| A25 | PASS | evidence-integrity host tests + verify_evidence.py on the final tree |
| A31 | PASS | fixture manifest lint (6 host tests); 10 synthetic fixtures, 698,510 bytes |

Remaining IDs (A04–A19, A21–A24, A26–A31 minus the S0 set) are `NOT_RUN` by design and are delivered by slices S1–S6; the final summary at `COMPLETE` accounts for every ID.

## Known limitations (measured in S0; updated as slices land)

- The OS share sheet itself is not automatable; `navigator.share` is spied and its payload asserted. Real-device share/installed-PWA/clipboard behavior is `NOT_RUN` unless the optional device pass happens (A27/A30).
- Playwright's WebKit on Linux grants no clipboard permissions; Copy is verified there by a real paste round-trip (readText is platform-denied). Chromium verifies with a real granted clipboard read.
- WebKit-on-Linux is not iOS Safari; no Safari claim is made.
- OCR accuracy is proven on the synthetic fixture set (clean-set CER 1.33% in-app; bench CER 2.31% raw), not on arbitrary real screenshots.
- Emoji-heavy and other variant fixtures arrive with the later-slice fixture expansion (plan: ≥ 40 variants by S4); the S0 set is plain-text posts, so the clean-set bar measures text reading.
