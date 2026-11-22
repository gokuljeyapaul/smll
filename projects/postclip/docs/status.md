# postclip — delivery status and evidence ledger

## Current status

- **Phase:** `BUILDING` (S0 and S1 merged and verified; S2 delivered; slices S3–S6 pending)
- **Active slice:** S2 — Input channels, installability (issue #55). `READY_FOR_MERGE` (PR opened by the building agent; the merge SHA is recorded in the next slice's update, per repo convention).
- **S0 merged:** PR https://github.com/gokuljeyapaul/smll/pull/61, merge SHA `98353b05197c1fe7f70aa61e7724f0182ea5c8c9` (squash), `monorepo / verify` green on `main` at the merge commit.
- **S1 merged:** PR https://github.com/gokuljeyapaul/smll/pull/63, merge SHA `bcc72240d490235ba812f56f9c3d8a30f2c23c14` (squash), `monorepo / verify` green on `main` at the merge commit.
- **Overall engineering result:** S0 acceptance (A01, A02, A03, A20, A25, A31) proven and re-verified on every later tree; S1 acceptance (A04, A05, A06, A07, A15) proven and re-verified on the S2 tree; S2 acceptance (A08, A09, A10, A11) proven — paste (real clipboard in Chromium; paste events everywhere the platform carries them), share target through the real service worker, denied-clipboard explanation with the picker still working, and an installable offline app shell (manifest + SW + complete precache, offline reload AND offline OCR in BOTH engines). Overall `IN_PROGRESS` (4 of 7 slices remaining).
- **Owner decisions:** CI needs no exception; LLM is progressive; OCR engine tesseract.js 7 + `4.0.0_fast` (S0 measurement); S2 adds ZERO npm dependencies — the PWA surface (manifest, service worker, precache generator, deterministic icons) is hand-built, and the choice + rejected alternatives (vite-plugin-pwa/Workbox) are recorded in `docs/evidence/S2/versions.json`.
- **Next required action:** merge S2 (autonomous merge when all gates hold), then S3 — Model manager: download once, then offline (issue #56).

## Slice overview

| Slice | Observable result | Status | PR / merge | Evidence |
|---|---|---|---|---|
| S0 | Pick screenshot → real browser OCR (tesseract.js in a Worker, both engines) → review → share (spied) / copy (real clipboard verification) | MERGED (SHA `98353b0`) | PR #61, merged as `98353b05197c1fe7f70aa61e7724f0182ea5c8c9` | `docs/evidence/S0/` |
| S1 | Cleanup, edit, export, English gate, clear errors, no-storage audit v1 | MERGED (SHA `bcc7224`) | PR #63, merged as `bcc72240d490235ba812f56f9c3d8a30f2c23c14` | `docs/evidence/S1/` |
| S2 | Paste (button + event), share-target receiver in the service worker, installable/offline app shell incl. offline OCR, clipboard-permission states | READY_FOR_MERGE | PR: see `milestone-status.json` / issue #55 | `docs/evidence/S2/` (red.log, green.log, e2e.log, negative.log, webkit-paste-probe.log, demo.log, junit/, versions.json, summary.json) |
| S3 | Model manager: pinned download, checksum, cache, fallback, offline | NOT_STARTED | — | — |
| S4 | Local LLM cleanup with safety guards (runtime/model chosen by measurement) | NOT_STARTED | — | — |
| S5 | Hardening, accessibility, production build checks | NOT_STARTED | — | — |
| S6 | Conformance, videos, compilation video | NOT_STARTED | — | — |

## Acceptance traceability

Per-ID statuses live in each slice's `docs/evidence/<slice>/summary.json` (JUnit-linked; `scripts/verify_evidence.py` enforces). S2 delivered (all prior IDs re-verified green on the S2 tree in the same final runs):

| ID | Status | Proof (see the slice `summary.json` for exact refs) |
|---|---|---|
| A01 | PASS (S0, re-verified S1+S2) | a01 smoke in both engines' S2 junit; videos |
| A02 | PASS (S0, re-verified S1+S2) | uc01 flow in both engines; real in-browser OCR on fixtures |
| A03 | PASS (S0, re-verified S1+S2) | uc01 flow: share spy payload + real clipboard verification (chromium read; webkit paste round-trip) |
| A20 | PASS (S0, re-verified S1+S2) | eval_ocr_cer_clean_set in both engines (raw-OCR CER vs gold; bar ≤ 5%) |
| A04 | PASS (S1, re-verified S2) | uc05_edit_reflects_in_payloads in both engines + host builder test |
| A05 | PASS (S1, re-verified S2) | uc07_export_downloads_md_txt_json in both engines + host builder test |
| A06 | PASS (S1, re-verified S2) | uc10_non_english_rejected_no_cleanup in both engines + host confusion matrix |
| A07 | PASS (S1, re-verified S2) | uc11_bad_input_error_states + uc11_huge_downscaled_before_ocr in both engines + host validator tests |
| A15 | PASS (S1, re-verified S2 with the planned S2 evolution) | a15 flows in both engines: the allow-list now admits exactly the app-shell precache cache, and the flow asserts that cache holds EXACTLY the build's precache entries (never share-target POST bodies, never post content); seeded-leak negative control still detects violations |
| A08 | PASS (S2) | a08_share_target_receives_image + the no-image negative, chromium: manifest share_target declared; a real multipart POST through the service worker hands the image to the pipeline and the review screen shows real OCR text |
| A09 | PASS (S2) | uc03 paste button (real clipboard image, granted permission) + paste event, chromium + host routing tests; the WebKit attempt is recorded in `webkit-paste-probe.log` (write(image) accepted, read() platform-denied, dispatched paste event WITH a file IS processed by the app) |
| A10 | PASS (S2) | a10_denied_paste_explains_and_picker_works, chromium: refused real read → the Paste button explains and the file picker still runs the full pipeline + host message-mapping tests |
| A11 | PASS (S2) | a11 installable (manifest valid + icons download + SW registered + complete precache incl. /ocr-assets/), offline reload renders the shell served by the worker with zero failed requests, AND offline OCR works — all in BOTH engines |
| A25 | PASS (S2 tree) | evidence-integrity (S2) host tests (121 host tests green) + verify_evidence.py on the final tree (digest matches) |
| A31 | PASS (S2 tree) | fixture manifest lint (10 host tests; fixtures unchanged by S2) |

Remaining IDs (A12–A14, A16–A19, A21–A24, A26–A30) are `NOT_RUN` by design and are delivered by slices S3–S6; the final summary at `COMPLETE` accounts for every ID.

## Known limitations (measured; updated as slices land)

- The OS share sheet itself is not automatable; `navigator.share` is spied and its payload asserted. Real-device share/installed-PWA/clipboard behavior is `NOT_RUN` unless the optional device pass happens (A27/A30). A08's service-worker POST is the plan's specified simulation of the Android share sheet; real installed-PWA sharing remains A27.
- Playwright's WebKit on Linux grants no clipboard permissions; `navigator.clipboard.read()` is platform-denied there (recorded in `docs/evidence/S2/webkit-paste-probe.log`), so A09's real-clipboard half is chromium-only per the plan's platform table. The same probe records that WebKit DOES accept `clipboard.write(image)` and DOES process a dispatched paste event carrying an image file (review screen appears) — the paste-event channel works for real WebKit users.
- The install prompt is browser chrome (not automatable); installability (A11) is checked structurally per the plan's testability map: valid manifest + registered service worker + complete precache + offline reload.
- Offline OCR (both engines, measured) proves the precached `/ocr-assets/` route end to end after a first online load on this machine; it does not measure device cache quotas, cold-start eviction, or real-phone offline behavior (A27/A30). The app-shell precache is ~39.1 MB per session (13 ocr-assets files + hashed app bundle + icons + manifest).
- Service-worker UPDATE behavior (a new deploy taking over an open tab) is not exercised: each Playwright context is fresh, so first-install + activate + claim are what the flows cover.
- WebKit-on-Linux is not iOS Safari; no Safari claim is made anywhere.
- The language gate is a deterministic script + common-English-word ratio (measured confusion matrix on the 21 readable fixtures: 100% English accepted, 0% non-English accepted); it does not prove behavior on arbitrary real-world non-English posts.
- Cleanup is deterministic English-only rules (A19's model cleanup and its real-OCR eval over all variants is S4).
- A15's audits prove the flows that ran, in Chromium and WebKit on this machine: from S2 the only storage that exists is the app-shell precache cache (asserted to hold exactly the build's precache entries — the share-target POST body is never cached or logged), no post text in storage/URL/cookies/console/network, all requests same-origin. The model cache (S3) will be the only other allowed persistence.
- A14 (zero network requests after the model cache exists) is S3; S2's request audit asserts same-origin-only traffic and no post text in any request.
- Emoji-heavy and other variant fixtures are synthetic; their host-side (gold-input) cleanup metrics are exact by construction, and their real-OCR behavior is exercised by the uc10/uc11/eval flows.
