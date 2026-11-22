# S1 metrics — cleanup quality, language gate, and the audit catch

All numbers below are measured, real runs on the building host (Debian 13,
16 vCPU, headless Chromium/WebKit via Playwright 1.65.1). Reproduce with the
commands at the bottom; the raw per-fixture output is also captured in the
JUnit XML (`docs/evidence/S1/junit/*-e2e.xml`, `system-out`) and `e2e.log`.

## Cleanup quality (A19 bars apply to S4's model cleanup; the S1 deterministic baseline is measured against the same gold)

Definitions live in `src/cleanup/metrics.ts`: word tokens
(`[\p{L}\p{N}][\p{L}\p{N}'’._-]*`, lowercased; emoji are not word tokens),
fuzzy match = Levenshtein ≤ 1 for tokens ≥ 4 chars (≤ 2 for ≥ 8) so OCR noise
is not counted against cleanup; **body-token F1** vs the gold body;
**chrome leakage** = gold chrome tokens present in the output and NOT
explained by gold body content; **fabricated tokens** = output tokens not
traceable (fuzzy) to the raw OCR input.

**Standard set** (12 fixtures, asserted in `eval_cleanup_body_f1_standard_set`
in both engines): the S0 ten (clean01–06, dark01–02, chrome01–02) plus the
S1 heavychrome01 and longpost01 fixtures.

### Real browser-OCR run through the app (Chromium AND WebKit, identical numbers)

| Fixture | body-token F1 | chrome leakage | fabricated |
|---|---|---|---|
| clean01 | 1.000 | 0.000 | 0.000 |
| clean02 | 1.000 | 0.000 | 0.000 |
| clean03 | 0.983 | 0.000 | 0.000 |
| clean04 | 1.000 | 0.000 | 0.000 |
| clean05 | 1.000 | 0.000 | 0.000 |
| clean06 | 1.000 | 0.000 | 0.000 |
| dark01 | 1.000 | 0.000 | 0.000 |
| dark02 | 1.000 | 0.000 | 0.000 |
| chrome01 | 1.000 | 0.000 | 0.000 |
| chrome02 | 1.000 | 0.000 | 0.000 |
| longpost01 | 0.986 | 0.111 | 0.000 |
| heavychrome01 | 1.000 | 0.000 | 0.000 |
| **mean (the bar)** | **0.997** ≥ 0.95 ✓ | **0.009** ≤ 0.02 ✓ | **0.000** ≤ 0.02 ✓ |

Notes, honestly:

- `clean03` F1 0.983: one gold body token lost to OCR noise on the
  bullet-list fixture, not to a cleanup rule.
- `longpost01` chrome leakage 0.111 is a **tokenizer artifact, not real
  chrome**: the reaction label "98 reactions - 5 comments" contributes the
  chrome token `5`, the gold body's list marker is `5.` (trailing period kept
  by the token class) while real OCR read the list marker as `5,` (comma not
  in the class) — so the single-digit token counts as "unexplained". The
  metric over-counts here, i.e. errs strict; the mean stays at 0.9%.
- Host-side (gold input, exact rules) the cleanup metrics are **F1 = 1.0,
  leakage = 0, fabricated = 0 for all 16 English fixtures** (asserted per
  fixture in `src/cleanup/cleanup.test.ts`).
- Variant fixtures (emoji01, blur01, lowcontrast01, huge01) are measured
  host-side on gold input (exact) and exercised end-to-end through the real
  pipeline by the uc10/uc11/eval flows; their full browser-OCR measurement
  belongs to the S4 eval (A19) which runs every variant.

## Language gate confusion matrix (A06)

Gate = script check (Latin share ≥ 0.85) + common-English-word ratio over
word tokens, threshold 0.12, fail-closed below 5 readable words. Measured
over the 21 readable fixtures' gold text (host, deterministic; the in-app
flow rejects real OCR output in both engines via `uc10_non_english_rejected`):

| Class | n | Accepted | Bar | Result |
|---|---|---|---|---|
| English (en) | 16 | 16 (100.0%) | ≥ 95% | PASS |
| German/Spanish (de/es) | 5 | 0 (0.0%) | 0 accepted | PASS |

Per-fixture stopword ratios (gold text): English min = 0.175 (clean03,
the list-heavy hiring post), English max = 0.463 (lowcontrast01);
non-English max = 0.033 (de03), non-English min = 0.019 (es02). The 0.12
threshold sits centered in the measured gap with ≥ 0.045 margin on both
sides (asserted in `src/language/gate.test.ts`). Full per-fixture values
print in the test output and land in `host-vitest.xml`'s `system-out`.

The gate list deliberately avoids German/Spanish collisions ("die", "hat",
"war", "real" are excluded); "no" and "was" stay in despite Spanish/German
use — the measured ratios still separate cleanly.

## OCR baseline re-measured on the S1 tree (A20, regression guard)

`eval_ocr_cer_clean_set` through the app's raw-OCR view: mean CER
**1.33%** in Chromium and 1.33% in WebKit (per-fixture: clean01=1.15%,
clean02=0.67%, clean03=1.57%, clean04=1.32%, clean05=1.49%, clean06=1.78%),
identical to the S0 baseline (bar ≤ 5%; no regression).

## The audit caught a real storage write (A15, negative-control story)

The first full S1 run failed **every** storage audit with:
`IndexedDB database "keyval-store" is not on the allow-list`. Root cause:
tesseract.js by default persists the traineddata into an IndexedDB named
`keyval-store` (its vendored idb-keyval). The plan allows only the
app-shell cache and the model cache, so the engine is now configured with
`cacheMethod: 'none'` (src/ocr/tesseract.ts): the pinned traineddata is
re-fetched same-origin instead, storage stays empty, and the S2
service-worker app shell will precache `/ocr-assets/` for offline use.
This is the A15 audit doing its job — the seeded-leak negative control
(`a15_audit_negative_control_detects_seeded_leak`) proves the audit is
not trivially empty, and this catch proves it runs against real state.

## Reproduce

```bash
export PLAYWRIGHT_BROWSERS_PATH=/opt/data/home/.cache/ms-playwright   # this container
cd projects/postclip
npm run build                                  # build (exit 0)
npx vitest run                                 # host suite incl. gate matrix + gold-input metrics (exit 0)
npx playwright test --project=chromium         # eval_cleanup/eval_ocr_cer/uc01..uc11/a15 (exit 0)
npx playwright test --project=webkit           # same in WebKit (exit 0)
node scripts/build_video_manifest.mjs S1 docs/evidence/S1/junit
bash scripts/verify.sh                         # plan lint + evidence integrity (exit 0)
```
