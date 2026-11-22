/**
 * The model-cleanup Worker (S4 — plan "LLM safety design" point 6): the
 * model runs here, OFF the page, with no tools, no network and no access to
 * the app's data — it receives ONLY the OCR text. The weights come from
 * the S3 model cache (OPFS or Cache Storage, engine-probed; the same
 * verified bytes the manager downloaded) as a Blob, so a cleanup makes
 * ZERO network requests (A14); the wllama WASM binary is an app-shell
 * asset (precache), not a fetch.
 *
 * Generation uses wllama's JSON-schema CONSTRAINED DECODING (A17: "grammar
 * / JSON-schema decoding if the runtime supports it" — llama.cpp compiles
 * CLEANUP_JSON_SCHEMA into a GBNF grammar), with thinking disabled for the
 * pinned Qwen3 chat model. The pipeline still strict-parses and validates
 * everything deterministically: constrained decoding is a generation
 * aid, never the guard.
 */

import { Wllama } from '@wllama/wllama';
import wllamaWasmUrl from '@wllama/wllama/esm/wasm/wllama.wasm?url';
import { openModelStore } from '../../model/store';
import { PINNED_MODEL } from '../../model/manifest';
import { CLEANUP_JSON_SCHEMA } from './schema';
import { buildCleanupMessages, type LlmMessage } from './prompt';
import { runModelCleanup, type CleanupOutcome } from './pipeline';

/** Context big enough for system + OCR + one JSON answer. */
const N_CTX = 2048;
/** Output cap: a long post's JSON answer is ~300-500 tokens. */
const MAX_TOKENS = 600;
/** Deterministic sampling: the MEASURED probe config (model_selection.md:
 * temperature 0.2, seed 42 — every recorded number comes from it; seed-fixed
 * sampling is reproducible run-to-run on a fixed build). Greedy
 * (temperature 0) was tried first and DEGENERATED on the conflicted
 * injection prompts — it ran to the token cap and the pipeline's fail-closed
 * 240 s budget, whereas the measured config completes them in ~90-140 s. */
const SAMPLING = { temperature: 0.2, seed: 42, top_p: 1 } as const;

let wllama: Wllama | null = null;
let loadPromise: Promise<Wllama> | null = null;

/** Load the pinned model from the CACHE bytes (never the network). */
async function getWllama(): Promise<Wllama> {
  if (wllama) return wllama;
  loadPromise ??= (async () => {
    const store = await openModelStore();
    if (!store) {
      throw new Error('model-cache-miss');
    }
    const key = `model-${PINNED_MODEL.sha256}.gguf`;
    const bytes = await store.read(key);
    if (!bytes) {
      throw new Error('model-cache-miss');
    }
    // Copy into a standalone ArrayBuffer so the Blob owns exact bytes.
    const exact = new Uint8Array(bytes.byteLength);
    exact.set(bytes);
    const instance = new Wllama({ default: wllamaWasmUrl }, { allowOffline: true });
    await instance.loadModel([new Blob([exact.buffer])], { n_ctx: N_CTX, seed: SAMPLING.seed });
    wllama = instance;
    return instance;
  })();
  try {
    return await loadPromise;
  } catch (err) {
    loadPromise = null; // a failed load is retried on the next cleanup
    throw err;
  }
}

/** One generation attempt (the pipeline's injected GenerateFn). */
async function generate(ocrText: string, attempt: number): Promise<string> {
  const instance = await getWllama();
  const messages = buildCleanupMessages(ocrText, attempt) as LlmMessage[];
  const response = await instance.createChatCompletion({
    messages,
    ...SAMPLING,
    max_tokens: MAX_TOKENS,
    cache_prompt: true,
    response_format: {
      type: 'json_schema',
      json_schema: { name: 'postclip_cleanup', schema: CLEANUP_JSON_SCHEMA, strict: true },
    },
    chat_template_kwargs: { enable_thinking: false },
  });
  return response.choices?.[0]?.message?.content ?? '';
}

export interface WorkerRequest {
  type: 'cleanup';
  id: number;
  lines: string[];
}

export interface WorkerResponse {
  type: 'result';
  id: number;
  outcome: CleanupOutcome;
  detail?: string;
}

self.addEventListener('message', async (event: MessageEvent<WorkerRequest>) => {
  const { type, id, lines } = event.data;
  if (type !== 'cleanup') return;
  try {
    const outcome = await runModelCleanup(generate, lines);
    const response: WorkerResponse = { type: 'result', id, outcome };
    self.postMessage(response);
  } catch (err) {
    // The worker-level catch (wasm aborts, cache misses, anything): the
    // app falls back to the deterministic cleanup and says so.
    const response: WorkerResponse = {
      type: 'result',
      id,
      outcome: {
        kind: 'fallback',
        reason: 'runtime-error',
        latencyMs: 0,
      },
      detail: err instanceof Error ? err.message : String(err),
    };
    self.postMessage(response);
  }
});
