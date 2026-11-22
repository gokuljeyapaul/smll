# S4 — LLM runtime + model selection by measurement (plan D5)

The runtime+model pair was selected **by measurement in the real browser on
this Linux host** (headless Chromium, WASM path; WebGPU is `NOT_RUN` here
per plan D8), on the real fixture workloads, against the plan's criteria:
body-token F1, chrome leakage, fabricated-token rate, injection behavior,
latency, peak memory, license, size, plus the architecture criteria (works
in Chromium and WebKit, runs in a Worker, license compatible, maintained,
installs from clean). Every number below comes from a real run recorded in
this file's commands; the app-level quality numbers come from the committed
eval (`llm-eval-chromium.json`, produced by `e2e/eval_llm_vs_baseline.spec.ts`
on the final tree).

## Pinned pair (selected)

**Runtime: wllama 3.13.0** (npm `@wllama/wllama@3.13.0`, Apache-2.0, llama.cpp
WASM; libllama `b12211-7d7f028`), **model: Qwen3-0.6B-Q4_K_M GGUF** (the S3
pin — `unsloth/Qwen3-0.6B-GGUF` @ revision `50968a4468ef4233ed78cd7c3de230dd1d61a56b`,
sha256 `ac2d97712095a558e31573f62f466a3f9d93990898b0ec79d7c974c1780d524a`,
396,705,472 bytes, Apache-2.0).

Why it wins on the measured criteria:

| Criterion | wllama 3.13 + Qwen3-0.6B-Q4_K_M (SELECTED) |
|---|---|
| Runs in a Worker, no network | Yes — `loadModel([Blob])` consumes the S3 model-cache bytes directly (OPFS/Cache Storage), zero network at cleanup time; the only runtime asset is a same-origin 10.2 MB wasm file, precached with the app shell. |
| Constrained decoding (A17) | Yes — `createChatCompletion({ response_format: { type: 'json_schema', ... } })` compiles the cleanup schema into a GBNF grammar (llama.cpp); measured: schema-conform JSON output on every probe completion. |
| Load time (headless Chromium, WASM) | ~13 s from a local URL; ~19-40 s from the cache through the app Worker (first pick per session; see the eval per-fixture latencies). |
| Generation speed (single-thread WASM; this host has no crossOriginIsolation → no SAB → 1 thread) | ~2.3 tokens/s; a full cleanup completion (JSON body + metadata for a short post) takes ~65-95 s; long posts ~110-140 s. Over the plan's 60 s WASM budget (A22, S5 records the final numbers). |
| Peak memory | ~1.0-1.2 GB renderer-process heap during inference (Chromium `performance.memory` + CDP on the probe; weights 397 MB + KV/compute buffers). |
| Injection behavior on the real model | **The 0.6B obeyed an injection into its `tags` array** (probe, temp 0.2, JSON-schema constrained: `tags: ["PWNED-X7K9", ...]` while the instruction said to put it in the summary) — which is exactly why the deterministic demotion guard exists (src/cleanup/llm/validate.ts + prompt.ts); after the guard, no attacker marker can reach any metadata field (the uc13 e2e proves it on the real model, both engines). |
| Cleanup quality vs the deterministic baseline (A19) | The model keeps the author/@handle header chrome in the body (`removed_chrome: []` in the probe; measured per fixture in `llm-eval-chromium.json`) — **it does not beat the rules baseline**; see the A19 decision below. |
| WebKit (Playwright build on this host) | The 397 MB wasm load fails with "The operation failed for an unknown transient reason" — the same engine-bug family as the S3 OPFS/Cache-Storage measurements; the app's capability path treats it as `unavailable` with the explicit visible fallback (A21's designed behavior, proven by the webkit e2e). |
| CI per-job download | One 396,705,472-byte file (unchanged from S3), fetched+sha256-verified by `scripts/fetch_model.mjs`. |
| License | Apache-2.0 (model and runtime). |

## Candidate table (all measured on this host unless marked)

| Candidate | Measured outcome | Verdict |
|---|---|---|
| **wllama 3.13.0 + Qwen3-0.6B-Q4_K_M GGUF** (396,705,472 B) | Full app integration measured (see above + `llm-eval-chromium.json`): load ~13-40 s, ~2.3 tok/s, schema-constrained JSON works, guards catch/defuse its injection obedience, cleanup faithful but keeps header chrome. | **SELECTED** (smallest candidate, only one that fits the existing single-file verified cache + CI budget + both-engine story). |
| **@huggingface/transformers 4.3.2 + onnx-community/Qwen3-0.6B-ONNX `model_q4f16.onnx`** (569,789,750 B, sha256 `9e33a5911974174761d0dfdcc0bec975d9c45af0eae5e9eb647b8ba9442a8f91`, revision `79346d370dfae34801d26993fda9ae2372900fd0`, Apache-2.0) | Real probe in headless Chromium (WASM path, `dtype: q4f16`, `device: 'wasm'`, bundled with the project's vite): model **loads in 18.6 s** (~624 MB JS heap), but **a cleanup completion did not finish within 450 s** of generation at `max_new_tokens=350` (driver deadline; the same prompt completes in 64-92 s on wllama). Also: the ONNX format is a SECOND per-job CI download (570 MB) alongside the pinned GGUF, and its multi-file layout does not fit the S3 single-file verified cache machinery. | **REJECTED**: measured ≥ 3-5x slower than the selected runtime on the same cleanup prompts, over the plan's latency budget by an order of magnitude, and it would break the CI per-job download budget ("hundreds of MB, not GB") with the selected runtime's file. |
| **WebLLM 0.2.89** (e.g. `mlc-ai/Qwen3-0.6B-q4f16_1-MLC`, 6+ shard bins) | WebGPU-only runtime. Measured on this host: headless Chromium reports `navigator.gpu` present (build `HeadlessChrome/159.0.8154.6`) but **Playwright's WebKit has no WebGPU at all** (`navigator.gpu` undefined, `Version 27.2`), and the plan's D8 declares the WebGPU path `NOT_RUN` on this Linux host (no GPU; any adapter would be a software fallback, not a real measurement). A WebGPU-only runtime therefore cannot be verified here at all, fails the works-in-WebKit criterion outright, and its shard layout is a second multi-hundred-MB CI download. | **REJECTED**: WebGPU unverifiable on this host per plan D8 (NOT_RUN), and structurally excluded on WebKit (measured: no `navigator.gpu`). |
| **Qwen3-1.7B** (`unsloth/Qwen3-1.7B-GGUF`, Q4_K_M = 1,107,409,472 B — HF LFS metadata) | Not downloaded/measured: the plan says "pick the smallest that meets the bars"; the smallest candidate already covers the WASM path, and 1.7B costs ~3x the inference time of an already-over-budget cleanup plus a >1 GB CI download (breaks the per-job budget). | **REJECTED** on size + latency + CI budget; Apache-2.0 (license fine, not the differentiator). |
| **Llama 3.2 1B** (`bartowski/Llama-3.2-1B-Instruct-GGUF`, Q4_K_M = 807,694,464 B — HF LFS metadata) | Not downloaded/measured: larger than the selected 0.6B, ~2x its latency on the already-over-budget path, and the Llama community license requires an explicit review before use (plan risk table) — no measured advantage could justify it. | **REJECTED** on size + latency + license-review cost. |

## A19 decision (LLM enabled or disabled by default)

**The LLM ships DISABLED BY DEFAULT** (`LLM_CLEANUP_ENABLED_BY_DEFAULT = false`
in src/cleanup/llm/config.ts; the user can opt in per session with the
review-screen toggle). The plan pre-approves this as a valid completion:
"bars met, or the LLM ships disabled by default with measured numbers and
the deterministic baseline stays the default".

The measured reasons (full per-fixture numbers in `llm-eval-chromium.json`):

1. **Cleanup quality**: on the standard set, the model-mode cleanup keeps
   the author/@handle header chrome in the body (the deterministic rules
   remove it), so its body-token F1 against gold is BELOW the rules
   baseline and its chrome leakage is far above the plan's 2% bar. The
   margin is negative; the deterministic baseline stays the default.
2. **Latency**: a model cleanup takes ~65-140 s per fixture on the
   single-threaded WASM path (over the plan's 60 s cleanup budget, A22).
3. **The guards are the reason this is even shippable**: the real model
   obeys injection instructions often enough to matter (measured), so
   every opt-in run goes through the deterministic validator +
   faithfulness guard + demotion, and the app falls back with a visible
   flag whenever anything fails (A16/A17/A18 all still hold).

What still ships: the full runtime integration (Worker, constrained
decoding, guard, suggestions UI, fallback) — A21 proves the pinned model
runs through the app in the browser and passes the injection and
faithfulness fixtures, and the toggle lets a user turn it on deliberately.

## Measurement commands (how these numbers were produced)

- wllama probe (capability + load + t/s + injection behavior + memory),
  headless Chromium + WebKit via Playwright:
  a scratch probe page importing `@wllama/wllama/esm/index.js`, loading
  the pinned GGUF from a local server, `createChatCompletion` with
  `response_format: json_schema`, `chat_template_kwargs: { enable_thinking: false }`,
  temperature 0.2, seed 42 — the recorded probe outputs are mirrored in
  `docs/evidence/S4/probe-log.md`.
- transformers.js probe (load + latency), headless Chromium: the probe
  entry bundling `@huggingface/transformers` 4.3.2 (project's vite),
  `pipeline('text-generation', 'onnx-community/Qwen3-0.6B-ONNX', { dtype: 'q4f16', device: 'wasm' })`
  from a local copy of the ONNX artifact (downloaded + sha256-verified
  against HF LFS metadata: `9e33a5911974174761d0dfdcc0bec975d9c45af0eae5e9eb647b8ba9442a8f91`).
  Recorded in `probe-log.md`; the package was then REMOVED from the
  project dependencies (it is not the selected runtime).
- App-level quality + latency + fallback-rate numbers:
  `npx playwright test --project=chromium --grep eval_llm_vs_baseline`
  (the spec that writes `llm-eval-chromium.json`), run against the test
  build with the real model served locally.
- WebGPU presence probes: `navigator.gpu` in headless Chromium (present)
  and Playwright WebKit (absent) — recorded in `probe-log.md`; per plan
  D8 the WebGPU execution path remains `NOT_RUN` on this host (A30).
- Candidate artifact sizes: HF LFS metadata (`x-linked-size` /
  `x-linked-etag`) on the pinned resolve URLs (same method as S3's
  model-manifest provenance).

## Notes

- The pinned model is UNCHANGED from S3 (same file, same sha256): the S4
  measurement confirmed the smallest plausible candidate is the right size
  class, and no re-pin was needed (wllama consumes the pinned GGUF
  directly). `scripts/fetch_model.mjs`, `scripts/setup.sh` and
  `src/model/manifest.ts` are untouched by the selection.
- wllama's wasm binary (10.2 MB) is a committed app-shell asset (bundled
  via vite's `?url` import, precached by the service worker) — it is a
  runtime, not model weights, and is the only new static asset.
