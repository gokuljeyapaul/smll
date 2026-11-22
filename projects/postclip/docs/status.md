# postclip — delivery status and evidence ledger

## Current status

- **Phase:** `BUILDING` (S0, S1, S2 and S3 merged and verified; S4 delivered; slices S5–S6 pending)
- **Active slice:** S4 — Local LLM cleanup and its guards (issue #57). `READY_FOR_MERGE` (PR opened by the building agent on branch feature/postclip/S4-local-llm-cleanup; the merge SHA is recorded in the next slice's update, per repo convention).
- **S0 merged:** PR https://github.com/gokuljeyapaul/smll/pull/61, merge SHA `98353b05197c1fe7f70aa61e7724f0182ea5c8c9` (squash), `monorepo / verify` green on `main` at the merge commit.
- **S1 merged:** PR https://github.com/gokuljeyapaul/smll/pull/63, merge SHA `bcc72240d490235ba812f56b9c3d8a30f2c23c14` (squash), `monorepo / verify` green on `main` at the merge commit.
- **S2 merged:** PR https://github.com/gokuljeyapaul/smll/pull/64, merge SHA `57b810483f66d9b1d4e00f2d02a1c873cc893a04` (squash), `monorepo / verify` green on `main` at the merge commit.
- **S3 merged:** PR https://github.com/gokuljeyapaul/smll/pull/65, merge SHA `ae333a508d784dc5b09878c931be90d24cfb0149` (squash), `monorepo / verify` green on `main` at the merge commit (SHA recorded here by the S4 slice per the next-slice convention).
- **Overall engineering result:** S0 acceptance (A01, A02, A03, A20, A25, A31) proven and re-verified on every later tree; S1 (A04, A05, A06, A07, A15) proven; S2 (A08, A09, A10, A11) proven; S3 (A12, A13, A14) proven; S4 acceptance (A16, A17, A18, A19, A21) proven — the runtime+model pair is resolved BY MEASUREMENT (plan D5): wllama 3.13 (llama.cpp WASM) + the pinned Qwen3-0.6B-Q4_K_M GGUF, chosen over transformers.js (measured ≥3x slower on the same prompts) and WebLLM (WebGPU-only: unverifiable on this host per plan D8, structurally excluded on WebKit). The model runs in a Worker off the S3 model cache with JSON-schema CONSTRAINED DECODING; every output passes the deterministic schema + faithfulness guard before it can replace the rules cleanup, and any failure falls back with the visible flag; injection posts are defused deterministically (the real 0.6B was measured OBEYING an injection into its tags array — the demotion guard is load-bearing, docs/evidence/S4/probe-log.md). **A19 decision: the LLM ships DISABLED BY DEFAULT** (the measured model-mode cleanup keeps header chrome in the body — below the rules baseline — and takes 65-140 s single-threaded WASM); the user can opt in per session and every opt-in run is guarded. Overall `IN_PROGRESS` (2 of 7 slices remaining).
- **Owner decisions:** CI needs no exception; OCR engine tesseract.js 7 + `4.0.0_fast` (S0 measurement); S2/S3 added ZERO npm dependencies; S4 adds ONE runtime dependency (`@wllama/wllama@3.13.0`, Apache-2.0 — the measured D5 winner; its 10.2 MB wasm is a precached app-shell asset, never model weights). The pinned model is UNCHANGED from S3.
- **Next required action:** merge S4 (autonomous merge when all gates hold), then S5 — Hardening and production build (issue #58).

## Slice overview

| Slice | Observable result | Status | PR / merge | Evidence |
|---|---|---|---|---|
| S0 | Pick screenshot → real browser OCR (tesseract.js in a Worker, both engines) → review → share (spied) / copy (real clipboard verification) | MERGED (SHA `98353b0`) | PR #61, merged as `98353b05197c1fe7f70aa61e7724f0182ea5c8c9` | `docs/evidence/S0/` |
| S1 | Cleanup, edit, export, English gate, clear errors, no-storage audit v1 | MERGED (SHA `bcc7224`) | PR #63, merged as `bcc72240d490235ba812f56b9c3d8a30f2c23c14` | `docs/evidence/S1/` |
| S2 | Paste (button + event), share-target receiver in the service worker, installable/offline app shell incl. offline OCR, clipboard-permission states | MERGED (SHA `57b8104`) | PR #64, merged as `57b810483f66d9b1d4e00f2d02a1c873cc893a04` | `docs/evidence/S2/` |
| S3 | Model manager: pinned download with visible progress, streamed sha256 verified before the cache, OPFS/Cache-Storage model cache, Range resume, fail-closed fallback banners, offline zero-network processing | MERGED (SHA `ae333a5`) | PR #65, merged as `ae333a508d784dc5b09878c931be90d24cfb0149` | `docs/evidence/S3/` |
| S4 | Local LLM cleanup + guards: measured runtime/model selection (wllama + the pinned 0.6B), Worker + JSON-schema constrained decoding, deterministic validator/faithfulness guard/demotion, fail-closed fallback, injection fixtures judged by the validator + marker checks, suggestions off by default, LLM disabled by default by the A19 measurement | READY_FOR_MERGE | PR on branch feature/postclip/S4-local-llm-cleanup (see issue #57) | `docs/evidence/S4/` (red.log, green.log, e2e.log, negative.log, demo.log, junit/, versions.json, model_selection.md, probe-log.md, llm-eval-chromium.json, owner/) |
| S5 | Hardening, accessibility, production build checks | NOT_STARTED | — | — |
| S6 | Conformance, videos, compilation video | NOT_STARTED | — | — |

## Acceptance traceability

Per-ID statuses live in each slice's `docs/evidence/<slice>/summary.json` (JUnit-linked; `scripts/verify_evidence.py` enforces). S4 delivered (all prior IDs re-verified green on the S4 tree in the same final runs):

| ID | Status | Proof (see the slice `summary.json` for exact refs) |
|---|---|---|
| A01 | PASS (S0, re-verified S1+S2+S3+S4) | a01 smoke in both engines' S4 junit; videos |
| A02 | PASS (S0, re-verified S1+S2+S3+S4) | uc01 flow in both engines; real in-browser OCR; also offline in a14 |
| A03 | PASS (S0, re-verified S1+S2+S3+S4) | uc01 flow: share spy payload + real clipboard verification; host suite keeps the default payload exactly the review text with the S4 suggestion toggles off |
| A20 | PASS (S0, re-verified S1+S2+S3+S4) | eval_ocr_cer_clean_set in both engines (raw-OCR CER vs gold; bar ≤ 5%) |
| A04 | PASS (S1, re-verified S2+S3+S4) | uc05_edit_reflects_in_payloads in both engines + host builder tests |
| A05 | PASS (S1, re-verified S2+S3+S4) | uc07_export_downloads_md_txt_json in both engines + host builder tests |
| A06 | PASS (S1, re-verified S2+S3+S4) | uc10_non_english_rejected_no_cleanup in both engines + host confusion matrix (now over the 40-fixture set) |
| A07 | PASS (S1, re-verified S2+S3+S4) | uc11_bad_input_error_states + uc11_huge_downscaled_before_ocr in both engines + host validator tests |
| A15 | PASS (S1/S2, re-verified S3+S4) | a15 flows in both engines; the S4 model-cleanup opt-in state is in-memory only (no new storage), and the a21/uc13 flows audit with the model host as the one designed exception |
| A08 | PASS (S2, re-verified S3+S4) | a08_share_target flows (chromium platform ID) + host routing tests |
| A09 | PASS (S2, re-verified S3+S4) | uc03 paste flows (chromium platform ID) + host routing tests |
| A10 | PASS (S2, re-verified S3+S4) | a10_denied_paste_explains_and_picker_works (chromium platform ID) + host message-mapping tests |
| A11 | PASS (S2, re-verified S3+S4) | a11 flows in both engines: valid manifest + SW with complete precache (now incl. the model-cleanup worker bundle + wllama wasm), offline reload and offline OCR |
| A12 | PASS (S3, re-verified S4) | a12 flows in both engines against the REAL pinned file served locally |
| A13 | PASS (S3, re-verified S4) | a13 flows in both engines: wrong-hash/truncated/404/unsupported fail closed with the banner + purge |
| A14 | PASS (S3, re-verified S4) | a14 in both engines: model cached → offline reload → zero-network processing |
| A16 | PASS (S4) | host adversarial suite (validator/demotion) + uc13_injection_posts_are_content_never_obeyed on the REAL pinned model in both engines (Chromium: guarded model path; WebKit: designed fallback), markers judged from gold.injection.markers |
| A17 | PASS (S4) | constrained decoding (wllama json_schema → GBNF) + strict-parse-with-one-retry + schema-violation rejections in the host suite; the a21 flows show the visible fallback flag |
| A18 | PASS (S4) | faithfulness guard host suite (multiset precision ≥ 0.98 fuzzy, chrome accounting, literal-or-drop metadata) + the real-model eval records every guard verdict (llm-eval-chromium.json) |
| A19 | PASS (S4) | browser eval (WASM path, headless Chromium) on real OCR output, both modes per pick; **decision: LLM ships DISABLED BY DEFAULT with the measured numbers** (model-mode keeps header chrome → below the rules baseline; 65-140 s per cleanup); the deterministic baseline meets the bars on the S4 tree (eval_cleanup_body_f1_standard_set, both engines) |
| A21 | PASS (S4) | a21 flows in both engines: the pinned model runs through the app in Chromium (validated result + suggestions off by default + payload exactly the review text) and the app correctly falls back and says so where it cannot run (WebKit's measured wasm-load failure; the testForceUnsupported probe path in both engines); uc13 covers the injection + faithfulness fixtures on the real model |
| A25 | PASS (S4 tree) | evidence-integrity (S4) host tests + verify_evidence.py on the final tree (digest matches) |
| A31 | PASS (S4 tree) | fixture manifest lint (40 fixtures incl. the ≥ 5 injection posts with gold markers, photo/rotation/tinytext families; hashes/sizes verified; ≤ 6 MB total) |

Remaining IDs (A22–A24, A26–A30) are `NOT_RUN` by design and are delivered by slices S5–S6; the final summary at `COMPLETE` accounts for every ID.

## Known limitations (measured; updated as slices land)

- The OS share sheet itself is not automatable; `navigator.share` is spied and its payload asserted. Real-device share/installed-PWA/clipboard behavior is `NOT_RUN` unless the optional device pass happens (A27/A30). A08's service-worker POST is the plan's specified simulation of the Android share sheet.
- Playwright's WebKit on Linux grants no clipboard permissions (recorded in S2); the paste-event channel works for real WebKit users.
- The install prompt is browser chrome; installability (A11) is checked structurally per the plan's testability map.
- **WebKit-on-Linux cannot run the model cleanup** (S4 measurement): the 397 MB wasm load fails with "unknown transient reason" — the same engine-bug family as the S3 storage measurements. The app treats it as `unavailable` with the explicit visible fallback (the designed D8 behavior); the real-model proofs are Chromium-only on this host. Real Safari behavior is `NOT_RUN`.
- WebGPU is `NOT_RUN` on this Linux host (plan D8): headless Chromium exposes `navigator.gpu` (a software adapter would back it), WebKit does not; no WebGPU-path claim is made anywhere (A30).
- **The LLM cleanup ships disabled by default** (A19 measurement): the pinned 0.6B keeps the author/@handle header chrome in the body (below the rules baseline) and a cleanup takes 65-140 s on the single-threaded WASM path (no crossOriginIsolation on this host → no SharedArrayBuffer → 1 llama.cpp thread). The opt-in toggle runs the same guarded pipeline.
- **The real model obeyed an injection in the S4 measurement** (into its tags array, under JSON-schema constrained decoding — probe-log.md). The deterministic demotion guard defuses this class on the applied path; the fixtures prove the guarded behavior on the real model, which is not a general prompt-injection impossibility result.
- Suggestion summaries are accepted only when every word is traceable to the OCR text (paraphrases with new words are dropped — fail closed), so the summary suggestion will often be absent by design.
- The single-threaded WASM path is ~2.3 tokens/s; latency/memory numbers are headless-Linux numbers. A22's budgets (OCR ≤ 5 s, cleanup ≤ 60 s WASM) are S5 scope; the S4 eval records that most model cleanups exceed 60 s single-threaded.
- The model cache backend is engine-dependent by measurement (S3): OPFS (Chromium) / Cache Storage (WebKit); real-device storage behavior is `NOT_RUN`.
- Service-worker UPDATE behavior is not exercised (each Playwright context is fresh); the SW keeps `postclip-model-*` caches alive across activates.
- Emoji-heavy and other variant fixtures are synthetic; their host-side cleanup metrics are exact by construction, and their real-OCR behavior is exercised by the uc10/uc11/eval flows.

## Owner-visual items

- O01 (S0), O02 (S1): confirmed by the owner in their issues.
- O03 (S3): `PENDING_OWNER_REVIEW` — `docs/evidence/S3/owner/` gallery; the tick-list is posted in issue #56.
- **O04 (S4): `PENDING_OWNER_REVIEW`** — `docs/evidence/S4/owner/` before/after gallery on six fixtures (raw OCR, rules only, model cleanup) incl. the hostile one, with flagged items visible; the tick-list is posted in issue #57.
- O05 (S5), O06 (S6): delivered by later slices.
