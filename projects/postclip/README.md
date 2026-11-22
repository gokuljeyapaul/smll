# postclip

Screenshot of a post in, clean shareable text out — in your browser, nothing uploaded.

1. Give it a screenshot of a LinkedIn-style post: pick, drop, paste, or (installed on Android) share it in.
2. OCR reads it in the browser; a small local model tidies it up where your browser can run one (removes buttons/UI, fixes line breaks).
3. You review and edit.
4. Share it (Telegram or any app via the share sheet), copy it, or export it as `.md` / `.txt` / `.json`.

No cloud, no accounts, nothing stored. English only (v1). An installable web app (PWA).

## Project state

**BUILDING.** S0 (foundations: pick a screenshot, real in-browser OCR, review, share or copy) is merged and verified; S1 (deterministic cleanup, editable review, .md/.txt/.json export, the English-only language gate, specific bad-input errors with downscale-before-OCR, and the no-storage/log/request audit) is merged and verified; S2 (paste button + paste events, the share-target receiver in the service worker, an installable offline app shell — including offline OCR — and clipboard-permission states) is merged and verified; S3 (the model manager: the pinned cleanup model downloads once with visible progress, is verified size+sha256 before it enters the model cache, resumes interrupted downloads, falls back with an explicit banner on any failure, and offline processing issues zero network requests) is merged and verified; S4 (the local LLM cleanup and its guards, measured into place: the pinned model runs in a Worker with JSON-schema constrained decoding, every output passes a deterministic schema + faithfulness guard before it can replace the rules cleanup, injection posts are defused deterministically, and the LLM ships **disabled by default** because the measurement showed it does not beat the rules baseline) is merged and verified; S5 (hardening: headless-Linux latency/memory budgets, axe accessibility in both color schemes plus a keyboard-only main flow, large-image memory safety, and a clean production build — bundle inspection proves no test hooks, the strict CSP ships and is enforced, the dist/ smoke passes) is delivered in Chromium and WebKit; slice S6 follows per the plan. The ledger in [docs/status.md](docs/status.md) tracks per-slice and per-acceptance-ID status with committed evidence.

| What | Where |
|---|---|
| Full plan (use cases, acceptance IDs, slices S0–S6, test strategy) | [docs/BUILD_PLAN.md](docs/BUILD_PLAN.md) |
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

## Why the evidence is trustworthy (by design)

- `scripts/plan_lint.py` keeps the plan internally consistent (every use case has an acceptance ID, a test path and a slice).
- `scripts/verify_evidence.py` rejects any `PASS` that is not backed by a committed, passing JUnit testcase for each required browser engine, any evidence produced from different code than the current tree, and any acceptance ID left unaccounted for at the end.
- Videos are recordings of *passing* Playwright flows, listed in a hashed manifest; one compilation video is committed.

Synthetic data only. A passing suite does not prove accuracy on arbitrary real screenshots, real-phone performance, WebGPU speed, or the real iOS/Android share sheets — those are reported as `PARTIAL` / `NOT_RUN` where they are not tested.
