/**
 * Capability probe (S3 — plan scope item "capability probe"): can THIS
 * browser plausibly download, cache and run the local model? Everything the
 * manager needs is checked up front, and an unsupported browser gets the
 * explicit fallback banner (UC09) instead of a broken download.
 */

import { testForceUnsupported } from './manifest';

export interface ModelCapabilities {
  supported: boolean;
  /** Static, human-readable reasons (never any user content). */
  reasons: string[];
}

/**
 * RED scaffold: no probing behavior yet — always claims support and ignores
 * the test-only override, so the unsupported-browser tests fail on the
 * missing behavior.
 */
export async function probeModelCapabilities(): Promise<ModelCapabilities> {
  void testForceUnsupported;
  return { supported: true, reasons: [] };
}
