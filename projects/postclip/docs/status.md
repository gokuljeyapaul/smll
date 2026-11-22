# postclip — delivery status and evidence ledger

## Current status

- **Phase:** `BUILDING` (S0 merged and verified; S1 delivered; slices S2–S6 pending)
- **Active slice:** S1 — Cleanup, edit, export, language gate, errors, no-storage v1 (issue #54). `READY_FOR_MERGE` (PR opened by the building agent; the merge SHA is recorded in the next slice's update, per repo convention).
- **S0 merged:** PR https://github.com/gokuljeyapaul/smll/pull/61, merge SHA `98353b05197c1fe7f70aa61e7724f0182ea5c8c9` (squash), `monorepo / verify` green on `main` at the merge commit.
- **Overall engineering result:** S0 acceptance proven (A01, A02, A03, A20, A25, A31) and re-verified on the S1 tree; S1 acceptance proven (A04, A05, A06, A07, A15 all PASS with committed JUnit evidence in both required engines). Overall `IN_PROGRESS` (5 of 7 slices remaining).
- **Owner decisions:** CI needs no exception; LLM is progressive; OCR engine tesseract.js 7 + `4.0.0_fast` (S0 measurement); S1 adds no new dependencies (export/downscale/gate/cleanup/audit are native-browser or pure TS).
- **Next required action:** merge S1 (autonomous merge when all gates hold), then S2 — Input channels, installability (issue #55).

## Slice overview

| Slice | Observable result | Status | PR / merge | Evidence |
|---|---|---|---|---|
| S0 | Pick screenshot → real browser OCR (tesseract.js in a Worker, both engines) → review → share (spied) / copy (real clipboard verification) | MERGED (SHA `98353b0`) | PR #61, merged as `98353b05197c1fe7f70aa61e7724f0182ea5c8c9` | `docs/evidence/S0/` |
| S1 | Cleanup, edit, export, English gate, clear errors, no-storage audit v1 | READY_FOR_MERGE | PR: see `milestone-status.json` / issue #54 | `docs/evidence/S1/` (red.log, green.log, e2e.log, negative.log, junit/, versions.json, metrics.md, owner/) |
| S2 | Paste, share-target, installable/offline shell | NOT_STARTED | — | — |
| S3 | Model manager: pinned download, checksum, cache, fallback, offline | NOT_STARTED | — | — |
| S4 | Local LLM cleanup with safety guards (runtime/model chosen by measurement) | NOT_STARTED | — | — |
| S5 | Hardening, accessibility, production build checks | NOT_STARTED | — | — |
| S6 | Conformance, videos, compilation video | NOT_STARTED | — | — |

## Acceptance traceability

Per-ID statuses live in each slice's `docs/evidence/<slice>/summary.json` (JUnit-linked; `scripts/verify_evidence.py` enforces). S0 delivered (re-verified green on the S1 tree) and S1 delivered:

| ID | Status | Proof (see the slice `summary.json` for exact refs) |
|---|---|---|
| A01 | PASS (S0, re-verified S1) | a01 smoke in both engines' S1 junit; videos |
| A02 | PASS (S0, re-verified S1) | uc01 flow in both engines; real in-browser OCR on fixtures |
| A03 | PASS (S0, re-verified S1) | uc01 flow: share spy payload + real clipboard verification (chromium read; webkit paste round-trip) |
| A20 | PASS (S0, re-verified S1) | eval_ocr_cer_clean_set in both engines (raw-OCR CER vs gold; bar ≤ 5%) |
| A04 | PASS (S1) | uc05_edit_reflects_in_payloads in both engines: edits flow exactly into share/copy/export |
| A05 | PASS (S1) | uc07_export_downloads_md_txt_json in both engines: real downloads read back + Vitest builders |
| A06 | PASS (S1) | uc10_non_english_rejected_no_cleanup in both engines + host confusion matrix (16/16 English accepted, 0/5 non-English accepted; zero-accept bar met) |
| A07 | PASS (S1) | uc11_bad_input_error_states + uc11_huge_downscaled_before_ocr in both engines + host validator tests (specific messages; huge downscaled before OCR) |
| A15 | PASS (S1) | a15_no_storage_log_request_leaks_after_flows in both engines (+ audit wired into every S1 flow) + a15_audit_negative_control_detects_seeded_leak (the audit is real, not trivially empty) |
| A25 | PASS (S1 tree) | evidence-integrity (S1) host tests + verify_evidence.py on the final tree |
| A31 | PASS (S1 tree) | evolved fixture manifest lint (10 host tests, 25 fixtures incl. de/es + bad-input variants) |

Remaining IDs (A08–A19 minus delivered, A21–A24, A26–A30) are `NOT_RUN` by design and are delivered by slices S2–S6; the final summary at `COMPLETE` accounts for every ID.

## Known limitations (measured; updated as slices land)

- The OS share sheet itself is not automatable; `navigator.share` is spied and its payload asserted. Real-device share/installed-PWA/clipboard behavior is `NOT_RUN` unless the optional device pass happens (A27/A30).
- Playwright's WebKit on Linux grants no clipboard permissions; Copy is verified there by a real paste round-trip (readText is platform-denied). Chromium verifies with a real granted clipboard read.
- WebKit-on-Linux is not iOS Safari; no Safari claim is made.
- The language gate is a deterministic script + common-English-word ratio (measured confusion matrix on the 21 readable fixtures: 100% English accepted, 0% non-English accepted, threshold 0.12 sits between min(en)=0.175 and max(non-en)=0.033); it does not prove behavior on arbitrary real-world non-English posts.
- Cleanup is deterministic English-only rules (A19's model cleanup and its real-OCR eval over all variants is S4); the S1 browser eval covers the standard set (12 fixtures) and the host suite proves exact-rule behavior on all 16 English fixtures.
- A15's storage audit asserts no storage at all in S1 (the app-shell cache arrives with the S2 service worker, the model cache with S3); IndexedDB enumeration is unavailable in some browser builds and is then recorded as a note, not silently ignored.
- Storage/URL/console/request audits prove the flows that ran in Chromium and WebKit on this machine, not arbitrary user behavior.
- Emoji-heavy and other variant fixtures are synthetic; their host-side (gold-input) cleanup metrics are exact by construction, and their real-OCR behavior is exercised by the uc10/uc11/eval flows.
