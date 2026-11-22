/**
 * The model-cleanup pipeline orchestration (S4 — plan "LLM safety design"
 * points 2-4; A17): generation (constrained when the runtime supports it,
 * else strict parse) with AT MOST ONE re-generation retry on a PARSE
 * failure, deterministic validation + guard, and the fail-closed fallback
 * to the deterministic cleanup with a visible flag. Never shows
 * unvalidated model text — a fallback outcome carries NO output value,
 * only the eval-only rawModelText record.
 *
 * The generation step is injected as a pure async function so the vitest
 * suite can drive the orchestration logic with adversarial fakes (a stub
 * proves the ORCHESTRATION, never the model — the real model is exercised
 * by the browser eval on the real pinned weights, plan rule).
 */

import type { LlmCleanupOutput } from './schema';
import { MAX_GENERATION_ATTEMPTS, strictParseJson } from './parse';
import { validateLlmCleanup, type ValidationResult } from './validate';

export type FallbackReason = 'invalid-output' | 'runtime-error' | 'timeout';

export interface ModelCleanupResult {
  /** 'model' — a verified, guard-passed model cleanup is available. */
  kind: 'model';
  output: LlmCleanupOutput;
  validation: ValidationResult;
  /** Number of generation attempts used (1 = first try, 2 = one retry). */
  attempts: number;
  latencyMs: number;
}

export interface ModelCleanupFallback {
  kind: 'fallback';
  reason: FallbackReason;
  /** Never shown to the user; recorded for the eval evidence only. */
  rawModelText?: string;
  latencyMs: number;
}

export type CleanupOutcome = ModelCleanupResult | ModelCleanupFallback;

/** One generation attempt: OCR text in, raw model text out. */
export type GenerateFn = (ocrText: string, attempt: number) => Promise<string>;

/**
 * The wall-clock budget for one cleanup (both attempts together). The
 * measured single-threaded WASM path needs 60-130 s per fixture, so the
 * default is generous; the UI surfaces a "running…" state while it waits
 * (A22's per-mode latency numbers are recorded by the S4/S5 evals).
 */
export const DEFAULT_CLEANUP_TIMEOUT_MS = 240_000;

function raceTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('pipeline-timeout')), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

export async function runModelCleanup(
  generate: GenerateFn,
  ocrLines: string[],
  opts: { now?: () => number; timeoutMs?: number } = {},
): Promise<CleanupOutcome> {
  const now = opts.now ?? Date.now;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_CLEANUP_TIMEOUT_MS;
  const started = now();
  const ocrText = ocrLines.join('\n');
  let lastRaw = '';

  for (let attempt = 1; attempt <= MAX_GENERATION_ATTEMPTS; attempt++) {
    const elapsed = now() - started;
    const remaining = Math.max(1, timeoutMs - elapsed);
    let raw: string;
    try {
      raw = await raceTimeout(generate(ocrText, attempt), remaining);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const reason: FallbackReason = message === 'pipeline-timeout' ? 'timeout' : 'runtime-error';
      return { kind: 'fallback', reason, rawModelText: lastRaw || undefined, latencyMs: now() - started };
    }
    lastRaw = raw;

    const parsed = strictParseJson(raw);
    if (!parsed.ok) {
      // A17: at most ONE retry — only for a parse failure; validation
      // failures fall back at once (retrying an invalid-but-parseable
      // answer just burns the budget).
      continue;
    }

    const validation = validateLlmCleanup(parsed.value, ocrLines);
    if (!validation.ok || !validation.value) {
      return { kind: 'fallback', reason: 'invalid-output', rawModelText: raw, latencyMs: now() - started };
    }
    return {
      kind: 'model',
      output: validation.value,
      validation,
      attempts: attempt,
      latencyMs: now() - started,
    };
  }

  return { kind: 'fallback', reason: 'invalid-output', rawModelText: lastRaw, latencyMs: now() - started };
}
