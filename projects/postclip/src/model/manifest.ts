/**
 * The pinned cleanup model (S3 — plan D5/D10, UC08/UC09/UC14).
 *
 * What is pinned: the smallest plausible D5 candidate — Qwen3 0.6B (the
 * smallest of the plan's model candidates), Apache-2.0, in GGUF (a single
 * file, the format wllama-style WASM runtimes need; the manager itself is
 * format-agnostic machinery). The runtime+model pair is resolved by
 * MEASUREMENT in S4; S4 may re-pin after its measurement, and this manifest
 * is the single place that changes.
 *
 * Every field below is a real recorded value: the URL pins the repo AND the
 * revision (a commit SHA, never a moving branch); sizeBytes and sha256 were
 * recorded from the real artifact (HF's LFS metadata for the pinned revision
 * cross-checked against a real download — see docs/evidence/S3/
 * model-manifest.json for the commands that produced them).
 */

export interface PinnedModel {
  id: string;
  repo: string;
  /** Commit SHA the URL is pinned to (immutable). */
  revision: string;
  filename: string;
  /** Pinned resolve URL (repo + revision + filename). */
  url: string;
  sha256: string;
  sizeBytes: number;
  format: string;
  license: string;
  licenseUrl: string;
  licenseNote: string;
}

/** The model cache (plan allow-list: app-shell cache + model cache ONLY). */
export const MODEL_CACHE_NAME = 'postclip-model-v1';

export const PINNED_MODEL: PinnedModel = {
  id: 'qwen3-0.6b-q4_k_m',
  repo: 'unsloth/Qwen3-0.6B-GGUF',
  revision: '50968a4468ef4233ed78cd7c3de230dd1d61a56b',
  filename: 'Qwen3-0.6B-Q4_K_M.gguf',
  url: 'https://huggingface.co/unsloth/Qwen3-0.6B-GGUF/resolve/50968a4468ef4233ed78cd7c3de230dd1d61a56b/Qwen3-0.6B-Q4_K_M.gguf',
  sha256: 'ac2d97712095a558e31573f62f466a3f9d93990898b0ec79d7c974c1780d524a',
  sizeBytes: 396705472,
  format: 'gguf',
  license: 'Apache-2.0',
  licenseUrl: 'https://huggingface.co/unsloth/Qwen3-0.6B-GGUF/blob/main/LICENSE',
  licenseNote:
    'Qwen3-0.6B weights are Apache-2.0 (Qwen3 license). 396,705,472 bytes (377.0 MiB): the smallest plausible D5 candidate, chosen so CI runner disk/time stay within bounds; S4 re-pins after its runtime/model measurement.',
};

/** The URL the manager downloads and caches (the test override, if any). */
export function modelUrl(): string {
  return testModelUrlOverride() ?? PINNED_MODEL.url;
}

/**
 * Pure parse of the test-only query flags (unit-tested; the gating on
 * __POSTCLIP_TEST_BUILD__ lives in the wrappers below so the production
 * bundle never even parses the query string — A29).
 */
export interface TestFlags {
  modelUrl: string | null;
  forceUnsupported: boolean;
}
export function parseTestFlags(search: string): TestFlags {
  const params = new URLSearchParams(search);
  const raw = params.get('testModelUrl');
  let modelUrl: string | null = null;
  if (raw) {
    try {
      const u = new URL(raw);
      if (u.protocol === 'http:' || u.protocol === 'https:') modelUrl = u.toString();
    } catch {
      modelUrl = null;
    }
  }
  return { modelUrl, forceUnsupported: params.get('testProbe') === 'unsupported' };
}

/**
 * TEST-ONLY override of the model URL (the local model server in the e2e
 * suite / demo). Test builds only: __POSTCLIP_TEST_BUILD__ is false in
 * production builds, so this branch is eliminated from the bundle (A29).
 */
export function testModelUrlOverride(): string | null {
  if (!__POSTCLIP_TEST_BUILD__) return null;
  try {
    return parseTestFlags(window.location.search).modelUrl;
  } catch {
    return null;
  }
}

/**
 * TEST-ONLY capability-probe override (plan UC09 testability row: "override
 * via a test-only query flag", test builds only — A29).
 */
export function testForceUnsupported(): boolean {
  if (!__POSTCLIP_TEST_BUILD__) return false;
  try {
    return parseTestFlags(window.location.search).forceUnsupported;
  } catch {
    return false;
  }
}
