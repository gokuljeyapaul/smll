# postclip — delivery status and evidence ledger

## Current status

- **Phase:** `BUILDING` (S0, S1 and S2 merged and verified; S3 delivered; slices S4–S6 pending)
- **Active slice:** S3 — Model manager: download once, then offline (issue #56). `READY_FOR_MERGE` (PR opened by the building agent on branch feature/postclip/S3-model-manager; the merge SHA is recorded in the next slice's update, per repo convention).
- **S0 merged:** PR https://github.com/gokuljeyapaul/smll/pull/61, merge SHA `98353b05197c1fe7f70aa61e7724f0182ea5c8c9` (squash), `monorepo / verify` green on `main` at the merge commit.
- **S1 merged:** PR https://github.com/gokuljeyapaul/smll/pull/63, merge SHA `bcc72240d490235ba812f56f9c3d8a30f2c23c14` (squash), `monorepo / verify` green on `main` at the merge commit.
- **S2 merged:** PR https://github.com/gokuljeyapaul/smll/pull/64, merge SHA `57b810483f66d9b1d4e00f2d02a1c873cc893a04` (squash), `monorepo / verify` green on `main` at the merge commit (SHA recorded here by the S3 slice per the next-slice convention).
- **Overall engineering result:** S0 acceptance (A01, A02, A03, A20, A25, A31) proven and re-verified on every later tree; S1 acceptance (A04, A05, A06, A07, A15) proven and re-verified; S2 acceptance (A08, A09, A10, A11) proven; S3 acceptance (A12, A13, A14) proven — the pinned cleanup model (Qwen3-0.6B-Q4_K_M, Apache-2.0, 396,705,472 bytes, repo+revision+URL+sha256 pinned in src/model/manifest.ts) downloads once with live progress, is verified size+sha256 BEFORE it enters the model cache (OPFS on Chromium / Cache Storage on WebKit, runtime-probed — both plan-sanctioned), resumes an interrupted download with a Range request, fails closed with an explicit banner and a purge on wrong-hash/truncated/404/unsupported, and with the model cached, offline processing issues ZERO network requests — all in BOTH engines, against the real pinned file served locally. Overall `IN_PROGRESS` (3 of 7 slices remaining).
- **Owner decisions:** CI needs no exception; LLM is progressive; OCR engine tesseract.js 7 + `4.0.0_fast` (S0 measurement); S2 added ZERO npm dependencies; S3 adds ZERO npm dependencies too — the state machine, streaming sha256, download/resume, both storage backends and the local model server are hand-built on platform APIs; the runtime+model pair is resolved by measurement in S4 (D5), which may re-pin after its measurement.
- **Next required action:** merge S3 (autonomous merge when all gates hold), then S4 — Local LLM cleanup and its guards (issue #57).

## Slice overview

| Slice | Observable result | Status | PR / merge | Evidence |
|---|---|---|---|---|
| S0 | Pick screenshot → real browser OCR (tesseract.js in a Worker, both engines) → review → share (spied) / copy (real clipboard verification) | MERGED (SHA `98353b0`) | PR #61, merged as `98353b05197c1fe7f70aa61e7724f0182ea5c8c9` | `docs/evidence/S0/` |
| S1 | Cleanup, edit, export, English gate, clear errors, no-storage audit v1 | MERGED (SHA `bcc7224`) | PR #63, merged as `bcc72240d490235ba812f56f9c3d8a30f2c23c14` | `docs/evidence/S1/` |
| S2 | Paste (button + event), share-target receiver in the service worker, installable/offline app shell incl. offline OCR, clipboard-permission states | MERGED (SHA `57b8104`) | PR #64, merged as `57b810483f66d9b1d4e00f2d02a1c873cc893a04` | `docs/evidence/S2/` |
| S3 | Model manager: pinned download with visible progress, streamed sha256 verified before the cache, OPFS/Cache-Storage model cache, Range resume, fail-closed fallback banners, offline zero-network processing | READY_FOR_MERGE | PR on branch feature/postclip/S3-model-manager (see issue #56) | `docs/evidence/S3/` (red.log, green.log, e2e.log, negative.log, demo.log, junit/, versions.json, summary.json, model-manifest.json, model-server-{chromium,webkit}.log, offline-request-log-{chromium,webkit}.txt, owner/) |
| S4 | Local LLM cleanup with safety guards (runtime/model chosen by measurement) | NOT_STARTED | — | — |
| S5 | Hardening, accessibility, production build checks | NOT_STARTED | — | — |
| S6 | Conformance, videos, compilation video | NOT_STARTED | — | — |

## Acceptance traceability

Per-ID statuses live in each slice's `docs/evidence/<slice>/summary.json` (JUnit-linked; `scripts/verify_evidence.py` enforces). S3 delivered (all prior IDs re-verified green on the S3 tree in the same final runs):

| ID | Status | Proof (see the slice `summary.json` for exact refs) |
|---|---|---|
| A01 | PASS (S0, re-verified S1+S2+S3) | a01 smoke in both engines' S3 junit; videos |
| A02 | PASS (S0, re-verified S1+S2+S3) | uc01 flow in both engines; real in-browser OCR; also offline in a14 |
| A03 | PASS (S0, re-verified S1+S2+S3) | uc01 flow: share spy payload + real clipboard verification (chromium read; webkit paste round-trip) |
| A20 | PASS (S0, re-verified S1+S2+S3) | eval_ocr_cer_clean_set in both engines (raw-OCR CER vs gold; bar ≤ 5%) |
| A04 | PASS (S1, re-verified S2+S3) | uc05_edit_reflects_in_payloads in both engines + host builder test |
| A05 | PASS (S1, re-verified S2+S3) | uc07_export_downloads_md_txt_json in both engines + host builder test |
| A06 | PASS (S1, re-verified S2+S3) | uc10_non_english_rejected_no_cleanup in both engines + host confusion matrix |
| A07 | PASS (S1, re-verified S2+S3) | uc11_bad_input_error_states + uc11_huge_downscaled_before_ocr in both engines + host validator tests |
| A15 | PASS (S1/S2, re-verified S3 with the planned S3 evolution) | a15 flows in both engines: the allow-list now admits the app-shell precache cache AND the model cache (postclip-model-*; OPFS on Chromium / Cache Storage on WebKit — the plan's second sanctioned persistence); the model flows audit with the pinned model host as the one designed cross-origin exception; seeded-leak negative control still detects violations |
| A08 | PASS (S2, re-verified S3) | a08_share_target flows (chromium platform ID) + host routing tests; the SW now also preserves the model cache across activates |
| A09 | PASS (S2, re-verified S3) | uc03 paste flows (chromium platform ID) + host routing tests |
| A10 | PASS (S2, re-verified S3) | a10_denied_paste_explains_and_picker_works (chromium platform ID) + host message-mapping tests |
| A11 | PASS (S2, re-verified S3) | a11 flows in both engines: valid manifest + SW with complete 20-entry precache (now incl. the model-manager bundle), offline reload and offline OCR |
| A12 | PASS (S3) | a12 flows in both engines, against the REAL pinned file served locally: live progress (DOM-observed intermediate values), streamed sha256, ready, exactly one cache entry of the pinned size; an interrupted download RESUMES with a Range request (wire-proven) or restarts cleanly; host state-machine/sha256/resume suites |
| A13 | PASS (S3) | a13 flows in both engines: wrong-hash / truncated / 404 / unsupported each leave an explicit fallback banner, the model cache PURGED, and the OCR + deterministic-cleanup path still passing (A02 re-verified); host fail-closed rules (verify-before-cache, purge, no-fetch-when-unsupported) |
| A14 | PASS (S3) | a14 in both engines: model cached → offline reload → cached model found with zero fetches → processing a fixture succeeds with the request log asserted EMPTY (SW-served precache is not network; definition documented in e2e/helpers/network.ts) |
| A25 | PASS (S3 tree) | evidence-integrity (S3) host tests (161 host tests green) + verify_evidence.py on the final tree (digest matches) |
| A31 | PASS (S3 tree) | fixture manifest lint (10 host tests; fixtures unchanged by S3) |

Remaining IDs (A16–A19, A21–A24, A26–A30) are `NOT_RUN` by design and are delivered by slices S4–S6; the final summary at `COMPLETE` accounts for every ID.

## Known limitations (measured; updated as slices land)

- The OS share sheet itself is not automatable; `navigator.share` is spied and its payload asserted. Real-device share/installed-PWA/clipboard behavior is `NOT_RUN` unless the optional device pass happens (A27/A30). A08's service-worker POST is the plan's specified simulation of the Android share sheet.
- Playwright's WebKit on Linux grants no clipboard permissions; `navigator.clipboard.read()` is platform-denied there (recorded in `docs/evidence/S2/webkit-paste-probe.log`), so A09's real-clipboard half is chromium-only per the plan's platform table. The paste-event channel works for real WebKit users.
- The install prompt is browser chrome (not automatable); installability (A11) is checked structurally per the plan's testability map: valid manifest + registered service worker + complete precache + offline reload.
- Offline OCR and offline model-cached processing (both engines, measured) prove the flows on this machine; they do not measure device cache quotas, cold-start eviction, or real-phone offline behavior (A27/A30). The app-shell precache is ~39.1 MB per session (20 entries incl. 13 ocr-assets files).
- Service-worker UPDATE behavior (a new deploy taking over an open tab) is not exercised: each Playwright context is fresh, so first-install + activate + claim are what the flows cover. The S3 change keeps `postclip-model-*` caches alive across SW activates (a new deploy never purges the user's downloaded model).
- WebKit-on-Linux is not iOS Safari; no Safari claim is made anywhere.
- The language gate is a deterministic script + common-English-word ratio; it does not prove behavior on arbitrary real-world non-English posts. Cleanup is deterministic English-only rules until S4.
- **Model cache backend is engine-dependent by measurement (S3):** headless Chromium's Cache Storage `put()` fails for a ~397 MiB body ("Unexpected internal error"), and Playwright's WebKit build has a broken async OPFS writable at every size — so the store layer probes with a real 4 KiB write and picks OPFS (Chromium) or Cache Storage (WebKit). Both are plan-sanctioned ("Cache Storage or OPFS"); real-device Safari/iOS storage behavior is `NOT_RUN`.
- **The runtime+model pair is S4's measurement (plan D5).** S3 pins the smallest plausible candidate (Qwen3-0.6B-Q4_K_M GGUF, Apache-2.0, 396,705,472 bytes) as a single format-agnostic file; S4 may re-pin. Processing in S3 is still the OCR + deterministic-cleanup pipeline — the model is downloaded, verified and cached, and `ModelManager.readCached()` is the S4 runtime entry point.
- **The streamed sha256 runs on the main thread** between chunk reads (~23 MB/s measured, so the download is hash-bound on fast links: ~17 s for the pinned file over localhost); the manager yields to the renderer every ~250 ms so the progress bar visibly moves, and the UI writes the bar to the DOM directly (React otherwise batches the whole loop into one commit). S4 may revisit hashing (e.g., a worker) together with the model runtime.
- **A12's resume is proven with the local server destroying fresh requests mid-body** (the wire log shows the Range resume at bytes=98566144-); real flaky-network behavior beyond that (packet loss, proxies) is not simulated.
- Emoji-heavy and other variant fixtures are synthetic; their host-side (gold-input) cleanup metrics are exact by construction, and their real-OCR behavior is exercised by the uc10/uc11/eval flows.

## Owner-visual items

- O01 (S0), O02 (S1): confirmed by the owner in their issues.
- **O03 (S3): `PENDING_OWNER_REVIEW`** — `docs/evidence/S3/owner/` gallery (download progress, checksum failure, fallback banner, plus ready and still-works shots) from a passing run; the tick-list is posted in issue #56.
- O04 (S4), O05 (S5), O06 (S6): delivered by later slices.
