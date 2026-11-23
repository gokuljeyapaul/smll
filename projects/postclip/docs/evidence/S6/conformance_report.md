# postclip — final conformance report (S6, phase COMPLETE)

**Every acceptance ID A01–A31, accounted for honestly on the final tree.**
29 IDs are `PASS`, each pointing at committed JUnit from the S6 final run
(`bash scripts/run_s6_final_evidence.sh`, all exit codes in `green.log`) that
passed on this exact tree — Chromium and WebKit wherever the plan's platform
column says `web`, Chromium-only where it says `chromium`, host suites where
it says `host`. 2 IDs are `NOT_RUN` by the plan's own design (the optional
real-device pass, A27/A30) — never faked, never quietly skipped.

- Final tree digest (`python3 scripts/verify_evidence.py --print-digest`):
  matches `summary.json` (enforced by `scripts/verify.sh`, run recorded in
  `green.log`).
- JUnit: `docs/evidence/S6/junit/` — `chromium-e2e.xml`, `webkit-e2e.xml`,
  `chromium-prod-e2e.xml`, `webkit-prod-e2e.xml`, `host-vitest.xml`.
- Videos: every UC flow recorded in both engines where it applies;
  `docs/evidence/video_manifest.json` (sha256/size/duration/junit per video)
  + the single committed compilation `docs/demo/postclip-demo.mp4`
  (≤ 15 MB, 720p) built by `scripts/make_demo_video.mjs` from these
  recordings.
- Statuses per ID live in `docs/evidence/S6/summary.json` (machine-checked);
  this report is the human-readable view of the same data.

## How to reproduce

```bash
bash scripts/preflight.sh                 # prerequisites
bash scripts/setup.sh                     # npm ci + browsers + the pinned model (sha256-verified)
bash scripts/run_s6_red.sh                # RED: both detectors must FAIL (they do)
bash scripts/run_s6_final_evidence.sh      # GREEN: the full suite, one pass, all stages
bash scripts/verify.sh                    # plan lint + evidence integrity (phase COMPLETE)
# the audit alone:
node scripts/audit_deps.mjs               # real tree -> CLEAN, exit 0
node scripts/audit_deps.mjs --seed-violation   # negative control -> trips, exit 1
```

## The accounting (A01–A31)

| ID | Criterion (plan, abridged) | Status | Evidence on the final tree |
|---|---|---|---|
| A01 | App loads, home screen, no console errors | **PASS** | `junit/chromium-e2e.xml` + `webkit-e2e.xml` :: a01_built_app_loads_home_screen_no_console_errors; video `a01_…_chromium`/`_webkit` |
| A02 | Real browser OCR turns a picked screenshot into review text (both engines) | **PASS** | uc01_pick_ocr_review_share (both engines; also offline in a14); videos per engine |
| A03 | Share calls navigator.share with the exact review text; Copy puts exactly that text on the clipboard | **PASS** | uc01 (both engines; share spy + real clipboard round-trip) + host payload invariant (host-vitest.xml); videos |
| A04 | Edits on the review screen flow into every payload | **PASS** | uc05_edit_reflects_in_payloads (both engines) + host builder tests; videos |
| A05 | Export downloads correct .md/.txt/.json content, read from the real download | **PASS** | uc07_export_downloads_md_txt_json (both engines) + host builders; production copy in a29; videos |
| A06 | Non-English screenshots rejected with a clear message, no cleanup/LLM run | **PASS** | uc10_non_english_rejected_no_cleanup (both engines) + host confusion matrix (30 EN + 5 DE/ES); videos |
| A07 | No-text/tiny/huge/corrupt/non-image inputs show specific messages, never crash; huge is downscaled before OCR | **PASS** | uc11_bad_input_error_states + uc11_huge_downscaled_before_ocr (both engines) + host validators; videos |
| A08 | Share target: manifest declares it; the SW receives a multipart POST and processes the image | **PASS** | a08_share_target_receives_image + ignores-posts-without-image (chromium platform ID per plan) + host routing; videos (chromium) |
| A09 | Pasting a real clipboard image (granted permission + paste event) processes it | **PASS** | uc03_paste_button_… + uc03_paste_event_… (chromium platform ID per plan); videos (chromium) |
| A10 | Clipboard-read denied → the Paste button explains; the picker still works | **PASS** | a10_denied_paste_explains_and_picker_works (chromium); video (chromium) |
| A11 | Installable (valid manifest + SW), and the shell loads offline after first load (incl. offline OCR) | **PASS** | a11_installable_manifest_and_sw_registered / offline_reload / offline_ocr (both engines); videos |
| A12 | First use downloads the pinned model with visible progress, verifies sha256, ends ready+cached; interrupted downloads resume | **PASS** | a12_model_downloads_verifies_caches + a12_interrupted_download_resumes (both engines, against the REAL pinned file served locally); videos |
| A13 | Checksum mismatch / truncated file / 404 / unsupported browser → fallback mode, explicit banner, bad file purged; OCR+rules still pass | **PASS** | a13_wrong_hash/truncated/404/unsupported (both engines); negative.log; videos |
| A14 | With the model cached, offline processing succeeds with ZERO network requests | **PASS** | a14_offline_processing_zero_network_requests (both engines; request log asserted empty); videos |
| A15 | No-storage audit: after every flow only allow-listed storage exists; no post text in any storage, URL, history, console or network request | **PASS** | a15_no_storage_log_request_leaks_after_flows (both engines) + the seeded-leak negative control a15_audit_negative_control_… (both engines, TRIPS — see negative.log); videos |
| A16 | Injection fixtures are treated as content; no obeyed instruction; no attacker marker in metadata | **PASS** | uc13_injection_posts_are_content_never_obeyed (both engines — Chromium on the REAL model, WebKit the designed fallback) + host adversarial suite; videos |
| A17 | LLM output constrained-decoded (or strictly parsed with ≤ 1 retry) and schema-validated; invalid output falls back flagged | **PASS** | host suite (constrained decoding, retry budget exactly one, schema rejections; host-vitest.xml) + a21 flows show the visible fallback flag (both engines) |
| A18 | Faithfulness guard: cleaned body traceable to OCR tokens; drops listed as chrome; else raw + deterministic cleanup, flagged | **PASS** | host faithfulness suite + the real-model eval records every guard verdict (eval_llm_vs_baseline, chromium junit) |
| A19 | Cleanup quality on real browser-OCR meets the bars; LLM beats the baseline or ships disabled with the numbers | **PASS** | eval_cleanup_body_f1_standard_set (both engines) + eval_llm_vs_baseline (chromium, real model): the LLM does NOT beat the baseline → ships DISABLED BY DEFAULT with the measured numbers (65–236 s, header chrome kept) |
| A20 | OCR accuracy on the clean set meets the CER bar in both engines; no regression > 1 pp | **PASS** | eval_ocr_cer_clean_set (both engines; bar ≤ 5%); videos |
| A21 | The pinned model runs in-browser (WASM, headless Chromium) and passes injection + faithfulness fixtures; where the browser cannot run it, the app falls back and says so | **PASS** | a21_model_cleanup_flow_verified_result_or_visible_fallback + a21_model_cleanup_off_by_default_… + a21_without_a_ready_model_… (both engines; WebKit = the designed fallback; WebGPU NOT_RUN per plan D8); production copy inert-hooks proof in a29 |
| A22 | Latency/memory budgets (headless-Linux): OCR ≤ 5 s/fixture; cleanup ≤ 60 s (WASM) | **PASS** | eval_latency_budgets_clean_set (both engines) + host cleanup-latency suite; the DEFAULT pipeline meets every budget; the opt-in LLM path's 65–236 s is the disclosed limitation behind its disabled-by-default state — recorded, never asserted green |
| A23 | axe: no serious/critical violations on every screen (both color schemes); keyboard-only main flow works | **PASS** | a23_axe_no_serious_or_critical_violations_every_screen + a23_keyboard_only_main_flow_… (both engines; the S5 RED run's two real contrast violations fixed); videos |
| A24 | Every UC01–UC14 has a passing flow recorded to video in Chromium and WebKit (where it applies); manifest lists sha256/size/duration/junit; a compressed compilation is committed | **PASS** | 22 flow testcases → junit per engine (below); per-flow videos in video_manifest.json; the committed compilation `docs/demo/postclip-demo.mp4` (manifest id `postclip_demo_compilation`, ≤ 15 MB, 720p, built from these S6 recordings) |
| A25 | Evidence integrity: every ID has a status; every PASS points at a passing JUnit testcase (per required engine); current-slice digest matches; the final summary accounts for every ID | **PASS** | `host-vitest.xml` :: evidence integrity (A25, S6) — 5 testcases; `scripts/verify_evidence.py` accepts the COMPLETE-phase accounting (green.log); the digest matches the tree |
| A26 | Dependency + license inventory; model pinned by repo/revision/sha256 with its license; no analytics/telemetry SDK; production CSP = same-origin + pinned host; production config matches the manifest | **PASS** | `scripts/audit_deps.mjs` (real `npm ls --all`: 269 packages, every license resolvable — MIT 197 / Apache-2.0 28 / ISC 15 / BSD-3 22 / MPL-2.0 4 / BlueOak 1 / Python-2.0 1 / CC-BY-4.0 1; no telemetry dep; no collection endpoint in dist/; CSP connect-src = [huggingface.co] only; the pin byte-verifies: sha256 ac2d9771…); `host-vitest.xml` :: audit deps (A26, S6) — 4 testcases; seeded-violation negative control in red.log + negative.log |
| A27 | Real-device checks: share sheet + Telegram delivery, installed-PWA share target (Android Chrome), clipboard (real iOS Safari) | **NOT_RUN** | The plan's optional device pass (D12); no real phone is attached to this runner — nothing claimed. Checklist for the owner: `docs/KNOWN_LIMITS.md` (+ A27 notes in summary.json). Everything automatable is green (uc01 share spy, a08 SW POST, uc03/a10 clipboard granted/denied) |
| A28 | Memory safety: 4000 px and ~20 MB images processed without crash, hang or tab failure | **PASS** | eval_large_images_4000px_and_20mb_processed_safely (both engines); the noise input's ~30 s OCR stage honestly recorded as exceeding the per-fixture budget (measured-and-rejected mitigations in the S5 evidence + KNOWN_LIMITS.md) |
| A29 | Production build: no test hooks/eval (bundle inspection), smoke from dist/, strict CSP shipped AND enforced | **PASS** | `bundle-inspection.txt` (CLEAN) + `chromium-prod-e2e.xml`/`webkit-prod-e2e.xml` :: a29_production_smoke / strict_csp / test_hooks_absent (both engines; the test-build control TRIPS — bundle-inspection-test-build.txt) |
| A30 | Real-phone LLM speed/RAM and WebGPU behavior | **NOT_RUN** | The plan's optional device pass (D12); WebGPU NOT_RUN on this host per plan D8 (software adapter only); headless-Linux WASM numbers recorded instead (~2.3 tokens/s; 65–236 s/cleanup; disabled by default). Checklist: `docs/KNOWN_LIMITS.md` |
| A31 | Fixtures and evidence are synthetic only; the manifest flags every image synthetic; no real screenshots anywhere | **PASS** | `host-vitest.xml` :: fixture manifest lint (A31) — 5 testcases (40 fixtures, sha256-matched, synthetic-flagged, < 6 MB); the ~20 MB eval input is generated at run time, never committed |

**Count: 31/31 accounted — 29 PASS, 2 NOT_RUN (A27/A30, the plan's optional
real-device pass).**

## A24 — the UC → flow → engine → video map

Every flow below is a passing testcase in the S6 JUnit with a recorded video
(`artifacts/video/<id>.webm`, manifest-listed; the committed compilation
follows the same order):

| UC | Flow testcase(s) | Engines |
|---|---|---|
| UC01 + UC06 | uc01_pick_ocr_review_share (share spied, copy real) | Chromium + WebKit |
| UC02 | a08_share_target_receives_image (multipart POST through the SW) | Chromium |
| UC03 | uc03_paste_button_processes_clipboard_image | Chromium |
| UC04 | a11_installable_manifest_and_sw_registered (+ offline reload) | Chromium + WebKit |
| UC05 | uc05_edit_reflects_in_payloads | Chromium + WebKit |
| UC07 | uc07_export_downloads_md_txt_json | Chromium + WebKit |
| UC08 | a12_model_downloads_verifies_caches | Chromium + WebKit |
| UC09 | a13_wrong_hash_falls_back_with_banner_and_purges | Chromium + WebKit |
| UC10 | uc10_non_english_rejected_no_cleanup | Chromium + WebKit |
| UC11 | uc11_bad_input_error_states + uc11_huge_downscaled_before_ocr | Chromium + WebKit |
| UC12 | a10_denied_paste_explains_and_picker_works | Chromium |
| UC13 | uc13_injection_posts_are_content_never_obeyed | Chromium (real model) + WebKit (designed fallback) |
| UC14 | a14_offline_processing_zero_network_requests | Chromium + WebKit |

The committed tour `docs/demo/postclip-demo.mp4` shows all 22 segments with
caption cards; long stages (the model download, the injection run, offline
processing) are sped up by the factor stated on their captions — every frame
is a real capture from this tree, nothing re-enacted.

## The audits (final tree)

- **Storage/log/request audit (A15):** after every flow, the allow-listed
  storage (app-shell cache + model cache only) is asserted and no post text
  appears in localStorage/sessionStorage/IndexedDB/Cache Storage/OPFS/cookies,
  URLs, history, console or any network request — with a seeded-leak negative
  control that TRIPS (proving the audit is not vacuous). See
  `negative.log`.
- **Dependency/license audit (A26):** `license_inventory.json` +
  `audit_deps.txt` (real `npm ls --all` tree; every license resolvable; zero
  analytics/telemetry SDKs; production bundle scanned for collection
  endpoints: none; CSP = same-origin + the pinned host only; the model pin
  byte-verifies against the cached weights). The seeded-violation control
  (a fake telemetry SDK, an extra CSP origin, a broken model pin) trips every
  detector class — `red.log` / `negative.log`.
- **Production build audit (A29):** `bundle-inspection.txt` CLEAN on `dist/`
  (no test hooks, no eval, the strict CSP verbatim); the TEST-build control
  TRIPS (`bundle-inspection-test-build.txt`).

## What a browser cannot do here (and where it is recorded)

The OS share sheet, the Telegram handoff and the native install prompt are
browser/OS chrome; the plan's testability map assigns their automated
surrogates (navigator.share spy, SW multipart POST, structural
installability) — all green above. The genuinely manual surface (real
phones) is the optional device pass: **A27/A30, `NOT_RUN`**, checklist in
`docs/KNOWN_LIMITS.md`; the owner answers it in issue #59 if they choose to
run it.
