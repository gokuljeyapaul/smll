/**
 * Capability probe (S3 — plan scope item "capability probe"): can THIS
 * browser plausibly download, cache and run the local model? Everything
 * the manager needs is checked up front, and an unsupported browser gets
 * the explicit fallback banner (UC09) instead of a broken download.
 */

import { testForceUnsupported } from './manifest';
import { modelStoreAvailable } from './store';

export interface ModelCapabilities {
  supported: boolean;
  /** Static, human-readable reasons (never any user content). */
  reasons: string[];
}

/**
 * The real probe: WebAssembly (any WASM-based local runtime), streaming
 * fetch, and a working model-cache backend (OPFS or Cache Storage — the
 * store layer probes OPFS with a real 4 KiB write because this engine
 * matrix has measured quirks, see src/model/store.ts). An unsupported
 * browser gets the explicit fallback banner (UC09) instead of a broken
 * download. The test-only ?testProbe=unsupported override forces the
 * unsupported path in test builds (A29).
 */
export async function probeModelCapabilities(): Promise<ModelCapabilities> {
  if (testForceUnsupported()) {
    return { supported: false, reasons: ['test override'] };
  }
  const reasons: string[] = [];
  if (typeof globalThis.WebAssembly !== 'object' || typeof globalThis.WebAssembly?.instantiate !== 'function') {
    reasons.push('WebAssembly is unavailable');
  }
  if (typeof globalThis.fetch !== 'function' || typeof globalThis.ReadableStream !== 'function') {
    reasons.push('streaming downloads are unavailable');
  }
  if (!(await modelStoreAvailable())) {
    reasons.push('no storage for the model cache is available');
  }
  return { supported: reasons.length === 0, reasons };
}
