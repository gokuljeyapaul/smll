# postclip — delivery status and evidence ledger

## Current status

- **Phase:** `COMPLETE` (S0–S5 merged; S6 — the final slice — delivered: conformance, videos, audit, known-limits. S6's merge SHA and the post-merge `monorepo / verify` result are reported in its done-comment in issue #59, per the final-slice convention — there is no next slice to record them in)
- **Active slice:** S6 — Conformance and videos (issue #59), branch `feature/postclip/S6-conformance-and-packaging`. `READY_FOR_MERGE` (PR opened by the building agent; closes #59).
- **S0 merged:** PR https://github.com/gokuljeyapaul/smll/pull/61, merge SHA `98353b05197c1fe7f70aa61e7724f0182ea5c8c9` (squash), `monorepo / verify` green on `main` at the merge commit.
- **S1 merged:** PR https://github.com/gokuljeyapaul/smll/pull/63, merge SHA `bcc72240d490235ba812f56b9c3d8a30f2c23c14` (squash), `monorepo / verify` green on `main` at the merge commit.
- **S2 merged:** PR https://github.com/gokuljeyapaul/smll/pull/64, merge SHA `57b810483f66d9b1d4e00f2d02a1c873cc893a04` (squash), `monorepo / verify` green on `main` at the merge commit.
- **S3 merged:** PR https://github.com/gokuljeyapaul/smll/pull/65, merge SHA `ae333a508d784dc5b09878c931be90d24cfb0149` (squash), `monorepo / verify` green on `main` at the merge commit.
- **S4 merged:** PR https://github.com/gokuljeyapaul/smll/pull/66, merge SHA `97a082c03867dc72c077dcbfe3ef6054262532c2` (squash), `monorepo / verify` green on `main` at the merge commit.
- **S5 merged:** PR https://github.com/gokuljeyapaul/smll/pull/67, merge SHA `70d64678c532d3032f2a3af127a37fd0f8af70bd` (squash) — `monorepo / verify` PASSED on the PR head; the fresh main run at the merge commit then hit the CI model-download stall (Chromium network-stack environment roulette, documented in issue #58), root-caused and resolved through the owner-approved recovery chain #68 (observability), #69 (root-cause fix), #70 (failure-diagnostics upload) and #71 (retry budget 3→6); main's `monorepo / verify` is green at `43c7da8` (the #71 merge). SHA recorded here by the S6 slice per the next-slice convention.
- **Overall engineering result:** every acceptance ID is accounted for on the final tree: **29 of 31 `PASS`** (each backed by committed, passing JUnit from the S6 final run — Chromium AND WebKit wherever the plan requires the pair), **2 `NOT_RUN`** (A27/A30, the plan's optional real-device pass — honestly recorded, never faked; the owner's checklist is in `docs/KNOWN_LIMITS.md`). Every UC01–UC14 flow is recorded to video in both engines where it applies, and the single committed compilation video `docs/demo/postclip-demo.mp4` (≤ 15 MB, 720p) tours all of them. The final dependency/license audit (`scripts/audit_deps.mjs`) proves: a 269-package `npm ls --all` inventory with every license resolvable, zero analytics/telemetry SDKs, the production CSP allowing only same-origin plus the pinned model host, and the model pin byte-verified against the cached weights (sha256 `ac2d9771…`) — with a seeded-violation negative control proving the detectors trip. `docs/KNOWN_LIMITS.md` is written. Phase is `COMPLETE`.
- **Owner decisions:** CI needs no exception; OCR engine tesseract.js 7 + `4.0.0_fast` (S0 measurement); S2/S3 added ZERO npm dependencies; S4 added ONE runtime dependency (`@wllama/wllama@3.13.0`); S5 added ONE devDependency (`@axe-core/playwright@4.14.0`, test-side only); **S6 adds ZERO npm dependencies (scripts + docs only)**. The pinned model is UNCHANGED from S3.
- **Next required action:** merge S6 under the autonomous merge policy when its gates hold (CI green on the PR head), then post the done-comment with proof in issue #59. After that the project is complete except for the asynchronous owner-visual/planner reviews (never blocking) and the optional real-device pass (A27/A30).

## Slice overview

| Slice | Observable result | Status | PR / merge | Evidence |
|---|---|---|---|---|
| S0 | Pick screenshot → real browser OCR (tesseract.js in a Worker, both engines) → review → share (spied) / copy (real clipboard verification) | MERGED (SHA `98353b0`) | PR #61, merged as `98353b05197c1fe7f70aa61e7724f0182ea5c8c9` | `docs/evidence/S0/` |
| S1 | Cleanup, edit, export, English gate, clear errors, no-storage audit v1 | MERGED (SHA `bcc7224`) | PR #63, merged as `bcc72240d490235ba812f56b9c3d8a30f2c23c14` | `docs/evidence/S1/` |
| S2 | Paste (button + event), share-target receiver in the service worker, installable/offline app shell incl. offline OCR, clipboard-permission states | MERGED (SHA `57b8104`) | PR #64, merged as `57b810483f66d9b1d4e00f2d02a1c873cc893a04` | `docs/evidence/S2/` |
| S3 | Model manager: pinned download with visible progress, streamed sha256 verified before the cache, OPFS/Cache-Storage model cache, Range resume, fail-closed fallback banners, offline zero-network processing | MERGED (SHA `ae333a5`) | PR #65, merged as `ae333a508d784dc5b09878c931be90d24cfb0149` | `docs/evidence/S3/` |
| S4 | Local LLM cleanup + guards: measured runtime/model selection (wllama + the pinned 0.6B), Worker + JSON-schema constrained decoding, deterministic validator/faithfulness guard/demotion, fail-closed fallback, injection fixtures judged by the validator + marker checks, suggestions off by default, LLM disabled by default by the A19 measurement | MERGED (SHA `97a082c`) | PR #66, merged as `97a082c03867dc72c077dcbfe3ef6054262532c2` | `docs/evidence/S4/` |
| S5 | Hardening: headless-Linux latency/memory budgets (default pipeline within; the opt-in LLM path's numbers recorded), axe in both color schemes on every screen + keyboard-only main flow, large-image memory safety (4000 px + a generated ~20 MB input, no crash/hang/tab failure), clean production build (bundle inspection: zero test hooks/eval, negative control trips on the test build), strict CSP shipped verbatim + enforced, dist/ smoke in both engines | MERGED (SHA `70d6467`) | PR #67, merged as `70d64678c532d3032f2a3af127a37fd0f8af70bd` (CI-stall recovery #68–#71, owner-approved; main green at `43c7da8`) | `docs/evidence/S5/` |
| S6 | Conformance and completion: the final conformance report (31/31 IDs accounted: 29 PASS on the final tree, A27/A30 NOT_RUN by design), every UC flow re-recorded to video in both engines, the single committed compilation video `docs/demo/postclip-demo.mp4` (≤ 15 MB, 720p), the dependency/license/telemetry/CSP/model-pin audit + its seeded-violation negative control, `docs/KNOWN_LIMITS.md`, phase COMPLETE | MERGED (SHA `8f1ac47`) | PR #72, merged as `8f1ac473ed74cb7af8c69395e26242e76fca500d`; main's `monorepo / verify` green on the merge commit (recorded here by the DV slice per the next-slice-updates-the-merge-SHA convention) | `docs/evidence/S6/` (red.log, green.log, e2e.log, prod.log, negative.log, demo.log, audit_deps.txt, license_inventory.json, audit-negative-control.txt, bundle-inspection*.txt, junit/, versions.json, conformance_report.md, summary.json) |
| DV | Post-completion demo (issue #73, owner-requested): the natural-pace FULL-WORKING demo video `docs/demo/postclip-full-demo.mp4` — one continuous real run (real clipboard paste → real in-browser OCR → deliberate edit → real copy/share-spy/export downloads → real pinned-model download with visible progress from the local cache → opt-in model cleanup → real 239 s WASM inference → the guarded verified output), 94 s / 0.45 MB / 720p / silent; only the inference wait is time-lapsed (11×, disclosed in an on-screen caption); mp4 vs GIF measured (same-run GIF 0.63 MB — larger, so the mp4 is the committed asset); README gains the Demo section linking both videos and is re-audited against the shipped state; manifest entry `postclip_full_demo` | READY_FOR_MERGE | PR on branch `feature/postclip/demo-video-readme` (closes issue #73) | `docs/evidence/DV/` (capture.log, compress.log, markers.json, size-comparison.json, model-server.log, boundary frames, build-test.log, versions.json, summary.json) |

## Acceptance traceability (final accounting)

Per-ID statuses live in `docs/evidence/S6/summary.json` (machine-checked by `scripts/verify_evidence.py` at phase COMPLETE — the final summary must account for every ID) and are explained in human-readable form in **`docs/evidence/S6/conformance_report.md`** — ID → criterion → status → evidence pointer for all of A01–A31. Summary of the final state (all re-verified on the S6 final tree by the full-suite re-run; the refs below point at `docs/evidence/S6/junit/`):

| ID | Status | Proof (see `conformance_report.md` / the S6 `summary.json` for exact refs) |
|---|---|---|
| A01 | PASS | a01 smoke in both engines' S6 junit (under the shipped strict CSP); videos |
| A02 | PASS | uc01 flow in both engines; real in-browser OCR; also offline in a14 |
| A03 | PASS | uc01 flow: share spy payload + real clipboard verification; host payload invariant |
| A04 | PASS | uc05_edit_reflects_in_payloads in both engines + host builder tests; keyboard-only in a23 |
| A05 | PASS | uc07_export_downloads_md_txt_json in both engines + host builder tests; production build in a29 |
| A06 | PASS | uc10_non_english_rejected_no_cleanup in both engines + host confusion matrix |
| A07 | PASS | uc11_bad_input_error_states + uc11_huge_downscaled_before_ocr in both engines + host validator tests |
| A08 | PASS | a08_share_target flows (chromium platform ID) + host routing tests |
| A09 | PASS | uc03 paste flows (chromium platform ID) + host routing tests |
| A10 | PASS | a10_denied_paste_explains_and_picker_works (chromium platform ID) + host message-mapping tests |
| A11 | PASS | a11 flows in both engines: valid manifest + SW with complete precache, offline reload and offline OCR — under the shipped CSP (worker-src 'self') |
| A12 | PASS | a12 flows in both engines against the REAL pinned file served locally |
| A13 | PASS | a13 flows in both engines: wrong-hash/truncated/404/unsupported fail closed with the banner + purge |
| A14 | PASS | a14 in both engines: model cached → offline reload → zero-network processing |
| A15 | PASS | a15 flows in both engines + the seeded-leak negative control (trips); the strict CSP structurally enforces the no-third-party rule |
| A16 | PASS | host adversarial suite (validator/demotion) + uc13_injection_posts_are_content_never_obeyed on the REAL pinned model in both engines (Chromium: guarded model path; WebKit: designed fallback) |
| A17 | PASS | constrained decoding (wllama json_schema → GBNF) + strict-parse-with-one-retry + schema-violation rejections in the host suite; the a21 flows show the visible fallback flag |
| A18 | PASS | faithfulness guard host suite + the real-model eval records every guard verdict |
| A19 | PASS | browser eval re-run on the S6 tree; the LLM stays DISABLED BY DEFAULT with the measured numbers; the deterministic baseline meets the bars (eval_cleanup_body_f1_standard_set, both engines) |
| A20 | PASS | eval_ocr_cer_clean_set in both engines (raw-OCR CER vs gold; bar ≤ 5%) |
| A21 | PASS | a21 flows in both engines + uc13 + host payload invariant; a29 proves the production copy (hooks inert, real model-card state) |
| A22 | PASS | eval_latency_budgets_clean_set (both engines: OCR ≤ 5 s per fixture, default cleanup ms-level) + eval_large_images (4000 px fixture within budget) + host cleanup-latency suite; the opt-in LLM path's 65–236 s recorded as disclosed limitations (disabled by default) |
| A23 | PASS | a23_axe_no_serious_or_critical_violations_every_screen (both engines × both color schemes) + a23_keyboard_only_main_flow (both engines) |
| **A24** | **PASS** | every UC01–UC14 flow recorded to video in both engines where it applies (22 flow testcases; per-flow videos manifest-listed with sha256/size/duration/junit) + the committed compilation `docs/demo/postclip-demo.mp4` (manifest id `postclip_demo_compilation`) |
| A25 | PASS | evidence-integrity (S6) host tests + `scripts/verify_evidence.py` accepts the COMPLETE-phase accounting on the final tree (digest matches) |
| **A26** | **PASS** | `scripts/audit_deps.mjs`: 269-package license inventory (all resolvable), zero telemetry SDKs, production CSP = same-origin + the pinned host only, model pin byte-verified; audit-deps (S6) host tests; seeded-violation negative control trips every detector class |
| **A27** | **NOT_RUN** | the plan's optional real-device pass (D12); no real phone attached; checklist for the owner in `docs/KNOWN_LIMITS.md`; nothing claimed |
| A28 | PASS | eval_large_images_4000px_and_20mb_processed_safely in both engines: no crash/hang/tab failure; the ~20 MB noise input's OCR stage recorded as exceeding the per-fixture budget (disclosed) |
| A29 | PASS | bundle inspection CLEAN on dist/ + a29 production specs in both engines (smoke from dist/, CSP enforced, hooks absent + inert) |
| **A30** | **NOT_RUN** | the plan's optional real-device pass (D12); WebGPU `NOT_RUN` on this host per plan D8; headless-Linux WASM numbers recorded instead |
| A31 | PASS | fixture manifest lint (40 fixtures, sha256-matched, synthetic-flagged; the ~20 MB eval input is generated at run time, never committed) |

**Final count: 31/31 accounted — 29 `PASS`, 2 `NOT_RUN` (A27/A30).**

## Known limitations (measured; the honest list)

The complete, current list with its evidence pointers lives in **`docs/KNOWN_LIMITS.md`** (the S6 deliverable). Highlights: the LLM cleanup ships disabled by default (A19's measured reason: slower and worse than the rules baseline); WebKit-on-Linux cannot run the model cleanup (engine bug — loud fallback); WebGPU is `NOT_RUN` on this host (plan D8); a ~20 MB adversarial-noise input processes safely but its OCR stage exceeds the per-fixture budget (measured; mitigations tried and rejected); the OS share sheet / Telegram handoff / install prompt are browser/OS chrome with the plan's specified automated surrogates; `frame-ancestors` belongs to the hosting layer (meta-policy spec limit); real-device behavior (A27/A30) awaits the optional pass.

## Owner-visual items

- O01 (S0), O02 (S1): confirmed by the owner in their issues.
- O03 (S3): `PENDING_OWNER_REVIEW` — `docs/evidence/S3/owner/` gallery; the tick-list is posted in issue #56.
- O04 (S4): `PENDING_OWNER_REVIEW` — `docs/evidence/S4/owner/` before/after gallery on six fixtures; the tick-list is posted in issue #57.
- **O05 (S5): `PENDING_OWNER_REVIEW`** — `docs/evidence/S5/owner/` mobile-viewport (390x844) screenshots (home, VISIBLE keyboard focus, review, export menu), an offline-reload shot and an offline pick→review shot; the tick-list is posted in issue #58.
- **O06 (S6): `PENDING_OWNER_REVIEW`** — `docs/demo/postclip-demo.mp4`, the single committed compilation video (≤ 15 MB, 720p) of every UC01–UC14 flow in Chromium and WebKit, built from the real S6 per-flow recordings; the tick-list is posted in issue #59 (never blocks the merge).
