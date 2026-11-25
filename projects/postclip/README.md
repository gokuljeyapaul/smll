# postclip

Screenshot of a post in, clean shareable text out — in your browser, nothing uploaded.

1. Give it a screenshot of a LinkedIn-style post: (installed on Android) share it in, paste it, or pick/drop it.
2. It starts reading by itself — including text inside pictures within the screenshot — and the screen lands on **your text with a large Copy button first**, then Share and file-save, then Edit.
3. A small local model can tidy it up further where your browser can run one (optional, collapsed out of the way, off by default).
4. Share it (Telegram or any app via the share sheet), copy it, or export it as `.md` / `.txt` / `.json`.

No cloud, no accounts, nothing stored. English only (v1). An installable web app (PWA) — and, since round 2, an embeddable component: a host app can embed PostClip in an iframe/WebView (responsive from 320 px up) and hand it screenshots through the postMessage contract (origin allow-list, default none) in [docs/INTEGRATION.md](docs/INTEGRATION.md). On iPhone, a plain web app cannot receive shares — the supported route is that host-app embedding ([docs/INTEGRATION.md](docs/INTEGRATION.md)).

## Demo

Both videos are silent (no audio track), ≤ 15 MB, 720p, phone-viewable from the repo, and recorded from **real runs of the real app** — real in-browser OCR and the real pinned model; no mockups, no screen-acting. Every recording is listed in the hashed manifest ([docs/evidence/video_manifest.json](docs/evidence/video_manifest.json)).

- **[Full-working demo — natural pace (94 s, 0.45 MB)](docs/demo/postclip-full-demo.mp4)** — one continuous run of everything the app does: paste a screenshot in → OCR in your browser → review and edit → copy / share / export (`.md` / `.txt` / `.json`) → download the tidy-up model once (real 377 MiB transfer with visible progress, sha256-verified before caching) → switch the model cleanup on → real on-device inference → the verified, guarded result. Every stage is natural pace except the model-inference wait (239 s of real single-threaded WASM time), which is shown 11× faster with the factor disclosed in an on-screen caption. Capture and measurement logs: [docs/evidence/DV/](docs/evidence/DV/); a same-run GIF (0.63 MB) was measured and rejected as larger (mp4 vs GIF comparison in `docs/evidence/DV/size-comparison.json`).
- **[Every-flow compilation — S6 (165 s, 7.1 MB)](docs/demo/postclip-demo.mp4)** — all fourteen use-case flows (UC01–UC14) in Chromium and WebKit, stitched from the per-flow Playwright recordings; long stages are sped up with the factor disclosed on each caption card.

## Project state

**Round 1 (S0–S6): complete.** S0 (foundations: pick a screenshot, real in-browser OCR, review, share or copy) is merged and verified; S1 (deterministic cleanup, editable review, .md/.txt/.json export, the English-only language gate, specific bad-input errors with downscale-before-OCR, and the no-storage/log/request audit) is merged and verified; S2 (paste button + paste events, the share-target receiver in the service worker, an installable offline app shell — including offline OCR — and clipboard-permission states) is merged and verified; S3 (the model manager: the pinned cleanup model downloads once with visible progress, is verified size+sha256 before it enters the model cache, resumes interrupted downloads, falls back with an explicit banner on any failure, and offline processing issues zero network requests) is merged and verified; S4 (the local LLM cleanup and its guards, measured into place: the pinned model runs in a Worker with JSON-schema constrained decoding, every output passes a deterministic schema + faithfulness guard before it can replace the rules cleanup, injection posts are defused deterministically, and the LLM ships **disabled by default** because the measurement showed it does not beat the rules baseline) is merged and verified; S5 (hardening: headless-Linux latency/memory budgets, axe accessibility in both color schemes plus a keyboard-only main flow, large-image memory safety, and a clean production build — bundle inspection proves no test hooks, the strict CSP ships and is enforced, the dist/ smoke passes) is merged and verified in Chromium and WebKit; S6 (the final round-1 slice: the conformance report accounting for every acceptance ID A01–A31 — 29 PASS on the final tree, A27/A30 honestly NOT_RUN as the plan's optional real-device pass — every UC flow recorded to video in both engines, the single committed compilation video `docs/demo/postclip-demo.mp4`, the dependency/license/telemetry/CSP/model-pin audit with its seeded-violation negative control, and `docs/KNOWN_LIMITS.md`) is merged and verified (PR #72, merge `8f1ac47`; main's `monorepo / verify` is green on the merge commit). After completion, the owner-requested demo slice (issue #73) recorded the natural-pace full-working demo video `docs/demo/postclip-full-demo.mp4` (see the Demo section above) and refreshed this README against the shipped state.

**Round 2 (the owner's hands-on review, epic #80): delivered.** R2-1 (PR #83) rebuilt the flow around the result: an arriving screenshot reads itself and lands on the text with a large Copy first (share-first arrival states, kind errors with one obvious next step, nested-image text included with measured recall, the iPhone hand-off documented in [docs/INTEGRATION.md](docs/INTEGRATION.md)); R2-3 (PR #84) made the optional tidy-up model download **once** and survive reloads and restarts — persist() requested only at the user's opt-in, the no-room and volatile-storage refusals kind and honest, the whole thing demoted behind a collapsed "Advanced" section (the 397 MB download is never pushed at anyone); R2-2 (PR #85) made PostClip **embeddable**: mobile-first responsive from 320 px (no overflow, ≥ 44 px touch targets, 100dvh, safe-area insets, light+dark) and a safe `postMessage` host contract (origin allow-list, default none, replies never `"*"`, 32 MiB cap) with the exact hosting header and iframe snippet in [docs/INTEGRATION.md](docs/INTEGRATION.md); R2-4 (issue #82) is the round's clean-up: the planner's mockups folded into the committed real screenshots, the stale docs trued up, the #58-chase debug logging removed, and the ledger completed. Round 2 added IDs A32–A46 and zero npm dependencies; every earlier acceptance ID stayed green through the round.

**Phase: `BUILDING`, honestly.** The build side of both rounds is done, but the owner-visual galleries O03–O09 are still awaiting the owner's review (O01/O02 confirmed; the tick-lists live in the slice issues) and the optional real-device pass (A27/A30) is NOT_RUN — the phase goes `COMPLETE` only when every owner-visual row is confirmed. The ledger in [docs/status.md](docs/status.md) tracks per-slice and per-acceptance-ID status with committed evidence; the round-1 final accounting is [docs/evidence/S6/conformance_report.md](docs/evidence/S6/conformance_report.md), round 2's re-affirmation on the cleaned final tree is [docs/evidence/R2-4/summary.json](docs/evidence/R2-4/summary.json), and the honest limits list is [docs/KNOWN_LIMITS.md](docs/KNOWN_LIMITS.md).

| What | Where |
|---|---|
| Full plan (use cases, acceptance IDs, slices S0–S10, test strategy) | [docs/BUILD_PLAN.md](docs/BUILD_PLAN.md) |
| Operating rules for the building agent | [AGENTS.md](AGENTS.md) |
| Ledger of delivered slices | [docs/status.md](docs/status.md) |
| Per-runner mechanics (Hermes, Claude Code on the web) | [docs/runners/](docs/runners/) |

## Commands

```bash
bash scripts/preflight.sh   # prerequisite check; BLOCKED if a required tool is missing
bash scripts/setup.sh       # preflight + npm ci + Playwright browsers + the pinned model (scripts/fetch_model.mjs, verified sha256, gitignored .cache/models/)
bash scripts/test.sh        # tool self-tests + typecheck + lint + Vitest + Playwright e2e (Chromium + WebKit, test build) + the production-build pass + bundle inspection
bash scripts/demo.sh        # end-to-end demo flows on the built app in real browsers (incl. the model download flows and the S4 model-cleanup opt-in)
bash scripts/verify.sh      # plan lint + evidence integrity
npm run fetch:model         # fetch/verify the pinned cleanup model into .cache/models/ (idempotent)
npm run generate:fixtures   # regenerate the synthetic fixture screenshots + gold + manifest (deterministic; artifacts are committed)
npm run bench:ocr           # OCR engine measurement bench (selection evidence, plan D4)
npm run test:e2e:prod       # production build + the e2e/prod pass (strict CSP shipped/enforced, test hooks absent, dist/ smoke) in both engines
npm run inspect:bundle      # bundle inspection over dist/ (no test hooks, no eval, the strict CSP verbatim)
npm run gen:large-fixture   # generate the deterministic ~20 MB A28 stress input into .cache/large-fixtures/ (never committed)
make test demo verify
```

The S4 slice adds the model-cleanup evidence tooling: `scripts/run_s4_red.sh` and `scripts/run_s4_final_evidence.sh` (the RED and one-pass GREEN evidence runs), `scripts/capture_owner_gallery_s4.mjs` (the O04 before/after gallery), and `docs/evidence/S4/` (the runtime/model selection measurement, the real-model eval JSON, and the per-slice logs).

The S5 slice adds the hardening/production evidence tooling: `scripts/run_s5_red.sh` and `scripts/run_s5_final_evidence.sh` (RED and GREEN evidence runs), `scripts/csp-policy.mjs` (the shipped CSP's single source of truth), `scripts/inspect_bundle.mjs` (the A29 bundle inspection + its test-build negative control), `scripts/gen_large_fixture.mjs` (the A28 ~20 MB stress input), `scripts/capture_owner_gallery_s5.mjs` (the O05 mobile gallery), and `docs/evidence/S5/` (the budget/axe/large-image/production-build evidence and per-slice logs).

The S6 slice adds the conformance/packaging tooling: `scripts/audit_deps.mjs` (the A26 dependency/license/telemetry/CSP/model-pin audit, with its `--seed-violation` negative control), `scripts/make_demo_video.mjs` (the committed ≤ 15 MB / 720p compilation video from the real per-flow recordings), `scripts/run_s6_red.sh` and `scripts/run_s6_final_evidence.sh` (the RED and one-pass GREEN evidence runs), and the final deliverables in `docs/evidence/S6/` (`conformance_report.md` — every ID A01–A31 with status + evidence pointer — `license_inventory.json`, `audit_deps.txt`, the junit and logs) plus `docs/KNOWN_LIMITS.md` and `docs/demo/postclip-demo.mp4`.

The post-completion demo slice (issue #73) adds the full-working demo tooling: `scripts/make_full_demo_video.mjs` (the natural-pace capture driver — one continuous real run of the test-built app with the real pinned model served from the local cache, every stage asserted) and `scripts/compress_full_demo.mjs` (post-production: title/end cards, the one disclosed 11× time-lapse of the model-inference wait, lower-third stage captions, the hard H.264 CRF-30 silent encode with a ≤ 15 MB budget check, the mp4-vs-GIF size comparison, and the video-manifest entry). Reproduce the committed asset with `npm run build:test && node scripts/make_full_demo_video.mjs && node scripts/compress_full_demo.mjs`; the run's evidence lives in `docs/evidence/DV/`.

The R2-4 clean-up slice (issue #82) adds the standing docs/dead-code consistency gate `scripts/cleanup_audit.sh` (wired into `scripts/test.sh`: no references to the deleted round-2 mockup folder, no round-2 TODO scaffolding, no stall-chase stage logging in shipped source, every ledger-linked evidence path exists) and the round's final evidence script `scripts/run_r2_4_final_evidence.sh` (stage-marked, like the earlier slices' scripts).

## Why the evidence is trustworthy (by design)

- `scripts/plan_lint.py` keeps the plan internally consistent (every use case has an acceptance ID, a test path and a slice).
- `scripts/verify_evidence.py` rejects any `PASS` that is not backed by a committed, passing JUnit testcase for each required browser engine, any evidence produced from different code than the current tree, and any acceptance ID left unaccounted for at the end.
- Videos are recordings of *passing* Playwright flows, listed in a hashed manifest; the only committed videos are the two demo assets in `docs/demo/` (the S6 every-flow compilation and the natural-pace full-working demo, both ≤ 15 MB, silent).

Synthetic data only. A passing suite does not prove accuracy on arbitrary real screenshots, real-phone performance, WebGPU speed, or the real iOS/Android share sheets — those are reported as `PARTIAL` / `NOT_RUN` where they are not tested.
