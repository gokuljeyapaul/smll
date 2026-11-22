# postclip

Screenshot of a post in, clean shareable text out — in your browser, nothing uploaded.

1. Give it a screenshot of a LinkedIn-style post: pick, drop, paste, or (installed on Android) share it in.
2. OCR reads it in the browser; a small local model tidies it up where your browser can run one (removes buttons/UI, fixes line breaks).
3. You review and edit.
4. Share it (Telegram or any app via the share sheet), copy it, or export it as `.md` / `.txt` / `.json`.

No cloud, no accounts, nothing stored. English only (v1). An installable web app (PWA).

## Project state

**BUILDING.** S0 (foundations: pick a screenshot, real in-browser OCR, review, share or copy) is merged and verified; S1 (deterministic cleanup, editable review, .md/.txt/.json export, the English-only language gate, specific bad-input errors with downscale-before-OCR, and the no-storage/log/request audit) is merged and verified; S2 (paste button + paste events, the share-target receiver in the service worker, an installable offline app shell — including offline OCR — and clipboard-permission states) is merged and verified; S3 (the model manager: the pinned cleanup model downloads once with visible progress, is verified size+sha256 before it enters the model cache, resumes interrupted downloads, falls back with an explicit banner on any failure, and offline processing issues zero network requests) is delivered in Chromium and WebKit with zero new dependencies; slices S4–S6 follow per the plan. The ledger in [docs/status.md](docs/status.md) tracks per-slice and per-acceptance-ID status with committed evidence.

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
bash scripts/test.sh        # tool self-tests + typecheck + lint + Vitest + Playwright e2e (Chromium + WebKit, test build)
bash scripts/demo.sh        # end-to-end demo flows on the built app in real browsers (incl. the model download flows)
bash scripts/verify.sh      # plan lint + evidence integrity
npm run fetch:model         # fetch/verify the pinned cleanup model into .cache/models/ (idempotent)
npm run generate:fixtures   # regenerate the synthetic fixture screenshots + gold + manifest (deterministic; artifacts are committed)
npm run bench:ocr           # OCR engine measurement bench (selection evidence, plan D4)
make test demo verify
```

## Why the evidence is trustworthy (by design)

- `scripts/plan_lint.py` keeps the plan internally consistent (every use case has an acceptance ID, a test path and a slice).
- `scripts/verify_evidence.py` rejects any `PASS` that is not backed by a committed, passing JUnit testcase for each required browser engine, any evidence produced from different code than the current tree, and any acceptance ID left unaccounted for at the end.
- Videos are recordings of *passing* Playwright flows, listed in a hashed manifest; one compilation video is committed.

Synthetic data only. A passing suite does not prove accuracy on arbitrary real screenshots, real-phone performance, WebGPU speed, or the real iOS/Android share sheets — those are reported as `PARTIAL` / `NOT_RUN` where they are not tested.
