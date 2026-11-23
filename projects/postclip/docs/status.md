# postclip — delivery status and evidence ledger

## Current status

- **Phase:** `BUILDING` (S0–S4 merged and verified; S5 delivered; slice S6 pending)
- **Active slice:** S5 — Hardening and production build (issue #58). `READY_FOR_MERGE` (PR opened by the building agent on branch feature/postclip/S5-hardening-production-build; the merge SHA is recorded in the next slice's update, per repo convention).
- **S0 merged:** PR https://github.com/gokuljeyapaul/smll/pull/61, merge SHA `98353b05197c1fe7f70aa61e7724f0182ea5c8c9` (squash), `monorepo / verify` green on `main` at the merge commit.
- **S1 merged:** PR https://github.com/gokuljeyapaul/smll/pull/63, merge SHA `bcc72240d490235ba812f56b9c3d8a30f2c23c14` (squash), `monorepo / verify` green on `main` at the merge commit.
- **S2 merged:** PR https://github.com/gokuljeyapaul/smll/pull/64, merge SHA `57b810483f66d9b1d4e00f2d02a1c873cc893a04` (squash), `monorepo / verify` green on `main` at the merge commit.
- **S3 merged:** PR https://github.com/gokuljeyapaul/smll/pull/65, merge SHA `ae333a508d784dc5b09878c931be90d24cfb0149` (squash), `monorepo / verify` green on `main` at the merge commit.
- **S4 merged:** PR https://github.com/gokuljeyapaul/smll/pull/66, merge SHA `97a082c03867dc72c077dcbfe3ef6054262532c2` (squash), `monorepo / verify` green on `main` at the merge commit (SHA recorded here by the S5 slice per the next-slice convention).
- **Overall engineering result:** S0 (A01, A02, A03, A20, A25, A31), S1 (A04, A05, A06, A07, A15), S2 (A08, A09, A10, A11), S3 (A12, A13, A14), S4 (A16–A19, A21) proven and re-verified on every later tree. S5 delivers the hardening pass: headless-Linux latency/memory budgets on the default pipeline (OCR ≤ 5 s per fixture met with wide margin; deterministic cleanup ms-level; the opt-in LLM path's 65–236 s recorded as the disclosed limitation behind its disabled-by-default state), axe accessibility in BOTH color schemes on every screen (two real shipped violations found by the RED run and fixed: dark primary-button label 2.55:1, hovered secondary button 2.63:1/1.29:1), a keyboard-only main flow, large-image memory safety (4000 px fixture + a generated ~20 MB input processed end to end with no crash/hang/tab failure; the noise input's OCR stage recorded honestly as exceeding the per-fixture budget with the measured-and-rejected mitigations), and a CLEAN production build: bundle inspection proves zero test hooks/eval in dist/ (the detector's negative control trips on the test build's 4 hook occurrences), the strict CSP ships verbatim and is ENFORCED (inline scripts blocked; connect-src same-origin + the pinned model host only), and the dist/ smoke passes in both engines. Overall `IN_PROGRESS` (1 of 7 slices remaining).
- **Owner decisions:** CI needs no exception; OCR engine tesseract.js 7 + `4.0.0_fast` (S0 measurement); S2/S3 added ZERO npm dependencies; S4 added ONE runtime dependency (`@wllama/wllama@3.13.0`); S5 adds ONE devDependency (`@axe-core/playwright@4.14.0`, the plan's A23 verification column; test-side only — the production bundle carries no axe code, verified by inspection). The pinned model is UNCHANGED from S3.
- **Next required action:** merge S5 (autonomous merge when all gates hold), then S6 — Conformance and videos (issue #59).

## Slice overview

| Slice | Observable result | Status | PR / merge | Evidence |
|---|---|---|---|---|
| S0 | Pick screenshot → real browser OCR (tesseract.js in a Worker, both engines) → review → share (spied) / copy (real clipboard verification) | MERGED (SHA `98353b0`) | PR #61, merged as `98353b05197c1fe7f70aa61e7724f0182ea5c8c9` | `docs/evidence/S0/` |
| S1 | Cleanup, edit, export, English gate, clear errors, no-storage audit v1 | MERGED (SHA `bcc7224`) | PR #63, merged as `bcc72240d490235ba812f56b9c3d8a30f2c23c14` | `docs/evidence/S1/` |
| S2 | Paste (button + event), share-target receiver in the service worker, installable/offline app shell incl. offline OCR, clipboard-permission states | MERGED (SHA `57b8104`) | PR #64, merged as `57b810483f66d9b1d4e00f2d02a1c873cc893a04` | `docs/evidence/S2/` |
| S3 | Model manager: pinned download with visible progress, streamed sha256 verified before the cache, OPFS/Cache-Storage model cache, Range resume, fail-closed fallback banners, offline zero-network processing | MERGED (SHA `ae333a5`) | PR #65, merged as `ae333a508d784dc5b09878c931be90d24cfb0149` | `docs/evidence/S3/` |
| S4 | Local LLM cleanup + guards: measured runtime/model selection (wllama + the pinned 0.6B), Worker + JSON-schema constrained decoding, deterministic validator/faithfulness guard/demotion, fail-closed fallback, injection fixtures judged by the validator + marker checks, suggestions off by default, LLM disabled by default by the A19 measurement | MERGED (SHA `97a082c`) | PR #66, merged as `97a082c03867dc72c077dcbfe3ef6054262532c2` | `docs/evidence/S4/` |
| S5 | Hardening: headless-Linux latency/memory budgets (default pipeline within; the opt-in LLM path's numbers recorded), axe in both color schemes on every screen + keyboard-only main flow, large-image memory safety (4000 px + a generated ~20 MB input, no crash/hang/tab failure), clean production build (bundle inspection: zero test hooks/eval, negative control trips on the test build), strict CSP shipped verbatim + enforced, dist/ smoke in both engines | READY_FOR_MERGE | PR on branch feature/postclip/S5-hardening-production-build (see issue #58) | `docs/evidence/S5/` (red.log, green.log, e2e.log, prod.log, negative.log, demo.log, junit/, versions.json, bundle-inspection.txt, bundle-inspection-test-build.txt, owner/) |
| S6 | Conformance, videos, compilation video | NOT_STARTED | — | — |

## Acceptance traceability

Per-ID statuses live in each slice's `docs/evidence/<slice>/summary.json` (JUnit-linked; `scripts/verify_evidence.py` enforces). S5 delivered (all prior IDs re-verified green on the S5 tree in the same final runs):

| ID | Status | Proof (see the slice `summary.json` for exact refs) |
|---|---|---|
| A01 | PASS (S0, re-verified S1–S5) | a01 smoke in both engines' S5 junit (now under the shipped strict CSP); videos |
| A02 | PASS (S0, re-verified S1–S5) | uc01 flow in both engines; real in-browser OCR; also offline in a14 |
| A03 | PASS (S0, re-verified S1–S5) | uc01 flow: share spy payload + real clipboard verification; host payload invariant |
| A20 | PASS (S0, re-verified S1–S5) | eval_ocr_cer_clean_set in both engines (raw-OCR CER vs gold; bar ≤ 5%) |
| A04 | PASS (S1, re-verified S2–S5) | uc05_edit_reflects_in_payloads in both engines + host builder tests; keyboard-only in a23 |
| A05 | PASS (S1, re-verified S2–S5) | uc07_export_downloads_md_txt_json in both engines + host builder tests; keyboard-only in a23; production build in a29 |
| A06 | PASS (S1, re-verified S2–S5) | uc10_non_english_rejected_no_cleanup in both engines + host confusion matrix |
| A07 | PASS (S1, re-verified S2–S5) | uc11_bad_input_error_states + uc11_huge_downscaled_before_ocr in both engines + host validator tests |
| A15 | PASS (S1/S2, re-verified S3–S5) | a15 flows in both engines + the seeded-leak negative control; the strict CSP now structurally enforces the no-third-party rule |
| A08 | PASS (S2, re-verified S3–S5) | a08_share_target flows (chromium platform ID) + host routing tests |
| A09 | PASS (S2, re-verified S3–S5) | uc03 paste flows (chromium platform ID) + host routing tests |
| A10 | PASS (S2, re-verified S3–S5) | a10_denied_paste_explains_and_picker_works (chromium platform ID) + host message-mapping tests |
| A11 | PASS (S2, re-verified S3–S5) | a11 flows in both engines: valid manifest + SW with complete precache, offline reload and offline OCR — under the shipped CSP (worker-src 'self') |
| A12 | PASS (S3, re-verified S4/S5) | a12 flows in both engines against the REAL pinned file served locally (under the test-build CSP) |
| A13 | PASS (S3, re-verified S4/S5) | a13 flows in both engines: wrong-hash/truncated/404/unsupported fail closed with the banner + purge |
| A14 | PASS (S3, re-verified S4/S5) | a14 in both engines: model cached → offline reload → zero-network processing |
| A16 | PASS (S4, re-verified S5) | host adversarial suite (validator/demotion) + uc13_injection_posts_are_content_never_obeyed on the REAL pinned model in both engines (Chromium: guarded model path; WebKit: designed fallback) |
| A17 | PASS (S4, re-verified S5) | constrained decoding (wllama json_schema → GBNF) + strict-parse-with-one-retry + schema-violation rejections in the host suite; the a21 flows show the visible fallback flag |
| A18 | PASS (S4, re-verified S5) | faithfulness guard host suite + the real-model eval records every guard verdict |
| A19 | PASS (S4, re-verified S5) | browser eval re-run on the S5 tree; the LLM stays DISABLED BY DEFAULT with the measured numbers; the deterministic baseline meets the bars (eval_cleanup_body_f1_standard_set, both engines) |
| A21 | PASS (S4, re-verified S5) | a21 flows in both engines + uc13 + host payload invariant; a29 proves the production copy (hooks inert, real model-card state) |
| A22 | PASS (S5) | eval_latency_budgets_clean_set (both engines: OCR ≤ 5 s per fixture, default cleanup ms-level) + eval_large_images (4000 px fixture within budget) + host cleanup-latency suite over all 40 fixtures; the opt-in LLM path's 65–236 s recorded as disclosed limitations (disabled by default) |
| A23 | PASS (S5) | a23_axe_no_serious_or_critical_violations_every_screen (both engines × both color schemes; the RED run's two real violations fixed in styles.css) + a23_keyboard_only_main_flow (both engines, focus visibility asserted at every stop) |
| A28 | PASS (S5) | eval_large_images_4000px_and_20mb_processed_safely in both engines: no crash/hang/tab failure, tab alive, follow-up pick works; the ~20 MB noise input's OCR stage recorded (exceeds the per-fixture budget — disclosed with the measured-and-rejected mitigations) |
| A29 | PASS (S5) | bundle inspection CLEAN on dist/ (zero hooks/eval; CSP verbatim; negative control trips on the test build) + a29 production spec in both engines (smoke from dist/, CSP enforced via the engine's own violation signal, hooks absent + inert) + host evidence-validation tests |
| A25 | PASS (S5 tree) | evidence-integrity (S5) host tests + verify_evidence.py on the final tree (digest matches) |
| A31 | PASS (S5 tree) | fixture manifest lint (40 fixtures, unchanged; the ~20 MB eval input is generated at run time, never committed) |

Remaining IDs (A24, A26, A27, A30) are `NOT_RUN` by design and are delivered by slice S6; the final summary at `COMPLETE` accounts for every ID.

## Known limitations (measured; updated as slices land)

- The OS share sheet itself is not automatable; `navigator.share` is spied and its payload asserted. Real-device share/installed-PWA/clipboard behavior is `NOT_RUN` unless the optional device pass happens (A27/A30). A08's service-worker POST is the plan's specified simulation of the Android share sheet.
- Playwright's WebKit on Linux grants no clipboard permissions (recorded in S2); the paste-event channel works for real WebKit users.
- The install prompt is browser chrome; installability (A11) is checked structurally per the plan's testability map.
- **WebKit-on-Linux cannot run the model cleanup** (S4 measurement): the 397 MB wasm load fails with "unknown transient reason" — the same engine-bug family as the S3 storage measurements. The app treats it as `unavailable` with the explicit visible fallback (the designed D8 behavior); the real-model proofs are Chromium-only on this host. Real Safari behavior is `NOT_RUN`.
- WebGPU is `NOT_RUN` on this Linux host (plan D8): headless Chromium exposes `navigator.gpu` (a software adapter would back it), WebKit does not; no WebGPU-path claim is made anywhere (A30).
- **The LLM cleanup ships disabled by default** (A19 measurement): the pinned 0.6B keeps the author/@handle header chrome in the body (below the rules baseline) and a cleanup takes 65–140 s on the single-threaded WASM path. The opt-in toggle runs the same guarded pipeline.
- **The real model obeyed an injection in the S4 measurement** (into its tags array, under JSON-schema constrained decoding — probe-log.md). The deterministic demotion guard defuses this class on the applied path; the fixtures prove the guarded behavior on the real model, which is not a general prompt-injection impossibility result.
- Suggestion summaries are accepted only when every word is traceable to the OCR text (paraphrases with new words are dropped — fail closed), so the summary suggestion will often be absent by design.
- The single-threaded WASM path is ~2.3 tokens/s; latency/memory numbers are headless-Linux numbers. **S5 (A22): the DEFAULT pipeline meets the budgets (OCR ≤ 5 s per fixture, deterministic cleanup ms-level); the opt-in LLM path exceeds the 60 s cleanup budget by measurement (65–236 s) and ships disabled by default — recorded, never asserted green.** WebKit exposes no performance.memory, so WebKit memory numbers are `NOT_RUN`.
- **S5 (A28): a ~20 MB adversarial-noise input processes end to end (no crash/hang/tab failure) but its OCR stage is ~30 s (Chromium) / ~45–49 s (WebKit)** — over the 5 s per-fixture OCR budget. Measured-and-rejected mitigations: PSM SINGLE_BLOCK for downscaled inputs (no effect — the LSTM pass over noise glyphs is the cost) and a lower OCR pixel cap (degrades real large screenshots). The 4000 px plan fixture stays within budget (0.6–2 s). Recorded in the S5 summary/limitations, captured failing in red.log.
- The model cache backend is engine-dependent by measurement (S3): OPFS (Chromium) / Cache Storage (WebKit); real-device storage behavior is `NOT_RUN`.
- Service-worker UPDATE behavior is not exercised (each Playwright context is fresh); the SW keeps `postclip-model-*` caches alive across activates.
- Emoji-heavy and other variant fixtures are synthetic; their host-side cleanup metrics are exact by construction, and their real-OCR behavior is exercised by the uc10/uc11/eval flows.
- The strict CSP ships as a meta policy (the static build's own artifact): `frame-ancestors` cannot be enforced in a meta policy (spec) and belongs to the hosting layer (D10, out of scope); everything else ships and is asserted.

## Owner-visual items

- O01 (S0), O02 (S1): confirmed by the owner in their issues.
- O03 (S3): `PENDING_OWNER_REVIEW` — `docs/evidence/S3/owner/` gallery; the tick-list is posted in issue #56.
- O04 (S4): `PENDING_OWNER_REVIEW` — `docs/evidence/S4/owner/` before/after gallery on six fixtures; the tick-list is posted in issue #57.
- **O05 (S5): `PENDING_OWNER_REVIEW`** — `docs/evidence/S5/owner/` mobile-viewport (390x844) screenshots (home, VISIBLE keyboard focus, review, export menu), an offline-reload shot and an offline pick→review shot; the tick-list is posted in issue #58.
- O06 (S6): delivered by the final slice.
