# postclip — known limits (honestly recorded)

This is the S6 known-limits document the plan asks for: **what was measured,
what is `NOT_RUN`, and what a browser simply cannot do here.** Every line is
backed by committed evidence; nothing is hidden behind a green checkmark.
The full per-ID accounting lives in `docs/evidence/S6/conformance_report.md`
and `docs/evidence/S6/summary.json` (all 31 acceptance IDs: 29 `PASS` on the
final tree, 2 `NOT_RUN`).

## What the product deliberately does NOT do

- **LLM cleanup ships disabled by default** (measured, A19). The pinned
  Qwen3-0.6B keeps the author/@handle header chrome in the body (below the
  deterministic-rules baseline) and a single cleanup takes **65–240 s** on the
  single-threaded WASM path (~2.3 tokens/s) — the S6 final-tree re-run measured
  112–240 s with several fixtures hitting the 240 s fail-closed cap — far over
  the 60 s cleanup budget. The opt-in toggle runs the same guarded pipeline for
  anyone who wants it; the default pipeline (deterministic rules) meets every
  budget and quality bar. Rationale: a feature that makes the product slower
  *and* worse is not shipped as the default.
- **English only, by design.** The language gate rejects non-English
  screenshots with a clear message and runs no cleanup/LLM on them (A06;
  30 English + 5 German/Spanish fixtures, confusion matrix committed).
  Adding languages is future work, not a defect.
- **No storage, no accounts, no cloud, no telemetry.** The only persistence is
  the app-shell cache and the model cache. No post text ever reaches
  localStorage, IndexedDB, Cache Storage, OPFS, cookies, URLs, history,
  console output or any network request (A15, audited after every flow, with
  a seeded-leak negative control that proves the detector trips).

## What could not be verified here (`NOT_RUN` — not skipped silently)

- **A27 — real-device checks** (Web Share sheet + Telegram delivery, the
  installed-PWA share target on Android Chrome, clipboard on real iOS
  Safari): the plan's optional ~30-minute device pass by the owner (D12).
  No real phone is attached to this runner. Everything automatable is green:
  `navigator.share` is spied with its payload asserted, the share-target POST
  is simulated through the real service worker, and clipboard permission
  granted/denied states are exercised in Chromium.
- **A30 — real-phone LLM speed/RAM and WebGPU.** WebGPU is `NOT_RUN` on this
  Linux host by plan decision D8 (headless Chromium exposes `navigator.gpu`
  only via a software adapter; WebKit does not expose it). No WebGPU-path
  claim is made anywhere. Real-device numbers await the optional device pass.
- **WebKit on Linux cannot run the model cleanup** (S4 measurement): the
  397 MB wasm load fails with an engine-bug-family error. The app treats it
  as `unavailable` and shows the designed visible fallback; all real-model
  proofs (download, cleanup, guards) are Chromium-only on this host. Real
  Safari behavior is `NOT_RUN`.
- **WebKit memory numbers are `NOT_RUN`:** this WebKit build exposes no
  `performance.memory` (engine limitation, recorded — Chromium numbers only).
- **Playwright's WebKit on Linux grants no clipboard permissions** (S2
  record); the paste-event channel works for real WebKit users and is what
  the paste flow exercises there.

## Measured limits (over budget or imperfect, disclosed)

- **A ~20 MB adversarial-noise image** processes end to end — no crash, hang
  or tab failure (A28) — but its OCR stage takes ~30 s (Chromium) / ~45–49 s
  (WebKit), over the 5 s per-fixture OCR budget. Mitigations were measured
  and rejected: PSM SINGLE_BLOCK for downscaled inputs (no effect — the LSTM
  pass over noise glyphs is the cost) and a lower OCR pixel cap (degrades
  real large screenshots). The 4000 px plan fixture stays within budget
  (~0.6–2 s).
- **The OS share sheet, the Telegram app handoff and the native install
  prompt are browser/OS chrome** — not automatable. A08's service-worker POST
  is the plan's specified simulation of the Android share sheet; A11's
  installability is checked structurally (manifest + SW + offline reload).
- **The strict CSP ships as a `<meta>` policy** (the static build's own
  artifact). `frame-ancestors` cannot be enforced in a meta policy (CSP spec)
  and belongs to the hosting layer (plan D10 keeps hosting out of scope).

## Round 2 (R2-1, share-first result screen) — measured and disclosed

- **Text inside pictures within the screenshot (A35, nested-image text).**
  Measured on the three synthetic nested-text fixtures (a quoted card, a
  launch banner and an event poster — each rendered as a REAL rasterized
  picture embedded in the card, ground truth committed as
  `nested_image_text`): nested-token recall **100.0% per fixture in both
  Chromium and WebKit** (multiset token recall, raw pre-cleanup OCR vs the
  ground truth; bar stated at ≥ 75%; per-engine JSON:
  `docs/evidence/R2-1/nested-text-recall-*.json`). That number is honest for
  this fixture set — flat synthetic pictures at screenshot resolution. It is
  NOT a promise about arbitrary photos: text in photos of physical scenes,
  heavily stylized logos, extreme perspective or very small print will read
  worse, exactly like the plan's honesty statement says about arbitrary real
  screenshots.
- **Which words came from INSIDE a picture is not labelled.** The R2-1
  mockup showed the nested text labelled ("Text found inside the pictures:
  …"); the app includes the text in one flow but does not label its origin,
  because OCR returns text without image-region segmentation and no
  segmentation model ships. Disclosed rather than faked.
- **The share-target POST route (A32/A36) is Chromium-only** (as A08):
  WebKit-on-Linux does not serve the service-worker share route, so the
  WebKit proof of the result-first screen is the pick path (A33); the share
  path itself is proven in Chromium, the platform the plan assigns it to.
- **Real installed-PWA sharing (Android) and the real iOS share sheet stay
  `NOT_RUN`** (A27, the plan's optional real-device pass; the automation
  simulates the exact service-worker POST the Android share sheet makes).
- **iPhone cannot receive shares in a plain web app** — a platform limit,
  honestly documented with the supported host-app route in
  `docs/INTEGRATION.md` (the host messaging contract is R2-2, issue #79).

## Round 1 bullets continue below

- **CSP enforcement: everything else ships and is asserted enforced.**
- **Suggestion summaries are accepted only when every word is traceable to
  the OCR text** (paraphrases with new words are dropped — fail closed), so
  the summary suggestion is often absent by design.
- **The real model obeyed an injection once** in the S4 measurement (into its
  tags array, under JSON-schema constrained decoding — probe-log.md). The
  deterministic demotion guard defuses this class on the applied path; the
  fixtures prove the guarded behavior on the real model. This is not a
  general prompt-injection impossibility result.
- **Offline model download UX**: the model download needs the network
  exactly once (first use, ~397 MB, with visible progress and a resumable
  Range request). Before that, offline users get the deterministic pipeline
  with a clear banner explaining what the model would add. After caching,
  processing makes zero network requests (A14) and works fully offline.
- **Service-worker UPDATE behavior** is not exercised (each Playwright
  context is fresh); the SW keeps `postclip-model-*` caches alive across
  activates.

## Optional real-device pass (A27/A30) — checklist for the owner

If you spend ~30 minutes with a real phone (the plan's D12), record the
results in issue #59:

1. **Share sheet + Telegram (Android Chrome or iOS Safari):** open
   `https://<host>/` (any static host serving `dist/`), pick a fixture
   screenshot, review, tap **Share** — the OS share sheet should offer
   Telegram; the shared text should equal the review text. (Automated here:
   payload asserted via `navigator.share` spy.)
2. **Installed-PWA share target (Android Chrome):** install the PWA, then
   from the gallery share a screenshot *to* PostClip — the app should open
   on the review screen with that image processed. (Automated here: the
   multipart POST through the real service worker.)
3. **Clipboard on real iOS Safari:** Copy, then paste into Notes — the text
   should match. (Automated here: real clipboard round-trip in Chromium.)
4. **Real-phone LLM speed/RAM (optional):** opt in to the model cleanup and
   note how long a cleanup takes on the phone's SoC and whether WebGPU is
   usable. (Automated here: WASM-path numbers, Chromium only.)

## Where the numbers live

Latency/memory budgets: `docs/evidence/S5/` (delivered) and the S6 re-run in
`docs/evidence/S6/e2e.log` (headless-Linux, single-threaded WASM, 16 vCPU /
62 GiB container — real-device behavior differs and is `NOT_RUN`). OCR
accuracy: `docs/evidence/S0/` + every later re-run. LLM measurements:
`docs/evidence/S4/`. License/dependency audit:
`docs/evidence/S6/license_inventory.json`. Videos:
`docs/evidence/video_manifest.json` + the committed tour
`docs/demo/postclip-demo.mp4`.
