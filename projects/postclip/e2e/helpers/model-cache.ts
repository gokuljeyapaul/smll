/**
 * Shared e2e helper (S3): inspect the REAL model cache after a flow, across
 * BOTH sanctioned backends (src/model/store.ts picks per engine: OPFS on
 * Chromium, Cache Storage on Playwright's WebKit — both measured; see
 * docs/evidence/S3/model-manifest.json). One uniform assertion surface for
 * both engines.
 */
import type { Page } from '@playwright/test';
import { PINNED_MODEL } from '../../src/model/manifest';

export interface ModelCacheState {
  /** Entry with the content-addressed key, per backend (null = absent). */
  opfsEntryBytes: number | null;
  cacheStorageEntryBytes: number | null;
  /** Every entry the model cache holds, in either backend. */
  totalEntries: number;
  /** R2-3: entries that are MODEL weights (the .gguf) — the marker records
   * (model-<sha>.verified.json, written after a verified download) are
   * sanctioned model-cache metadata and are counted separately. */
  modelEntries: number;
  backend: 'opfs' | 'cache-storage' | 'none';
}

export const MODEL_CACHE_KEY = `model-${PINNED_MODEL.sha256}.gguf`;

export async function readModelCacheState(page: Page): Promise<ModelCacheState> {
  return page.evaluate(async (key) => {
    let opfsEntryBytes: number | null = null;
    let opfsEntries = 0;
    let opfsModelEntries = 0;
    try {
      const root = await navigator.storage.getDirectory();
      const dir = await root.getDirectoryHandle('postclip-model');
      // FileSystemDirectoryHandle is an async iterator (no entries() on
      // older builds — the count is best-effort, the keyed reads are exact).
      try {
        const iterable = dir as unknown as {
          entries?: () => AsyncIterableIterator<[string, FileSystemHandle]>;
        };
        if (typeof iterable.entries === 'function') {
          for await (const [name, handle] of iterable.entries()) {
            opfsEntries += 1;
            if (String(name).endsWith('.gguf')) opfsModelEntries += 1;
            void handle;
          }
        }
      } catch {
        // no async iteration — fall back to the keyed lookup only
      }
      try {
        const fh = await dir.getFileHandle(key);
        opfsEntryBytes = (await fh.getFile()).size;
      } catch {
        opfsEntryBytes = null;
      }
    } catch {
      // no OPFS model dir on this engine
    }

    let cacheStorageEntryBytes: number | null = null;
    let cacheEntries = 0;
    let cacheModelEntries = 0;
    try {
      const names = await caches.keys();
      const modelName = names.find((n) => n.startsWith('postclip-model'));
      if (modelName) {
        const cache = await caches.open(modelName);
        const keys = await cache.keys();
        cacheEntries = keys.length;
        cacheModelEntries = keys.filter((k) => String(k.url ?? k).endsWith('.gguf')).length;
        const hit = await cache.match(key);
        cacheStorageEntryBytes = hit ? (await hit.blob()).size : null;
      }
    } catch {
      // Cache Storage unavailable
    }

    const backend: ModelCacheState['backend'] =
      opfsEntryBytes !== null
        ? 'opfs'
        : cacheStorageEntryBytes !== null
          ? 'cache-storage'
          : 'none';
    return {
      opfsEntryBytes,
      cacheStorageEntryBytes,
      totalEntries: opfsEntries + cacheEntries,
      modelEntries: opfsModelEntries + cacheModelEntries,
      backend,
    };
  }, MODEL_CACHE_KEY);
}

/** Uniform assertion: exactly one MODEL entry (the pinned .gguf with the
 * pinned bytes). R2-3 adds the sanctioned verified-marker records to the
 * same model cache; the no-duplicate-model invariant is about the weights
 * (A12's intent), so it counts .gguf entries — not the marker metadata. */
export async function expectModelCachedExactly(page: Page): Promise<ModelCacheState> {
  const state = await readModelCacheState(page);
  const stored = state.opfsEntryBytes ?? state.cacheStorageEntryBytes;
  if (stored !== PINNED_MODEL.sizeBytes) {
    throw new Error(
      `model cache must hold exactly the pinned ${PINNED_MODEL.sizeBytes} bytes, saw ${JSON.stringify(state)}`,
    );
  }
  if (state.modelEntries !== 1) {
    throw new Error(`model cache must hold exactly one MODEL entry, saw ${JSON.stringify(state)}`);
  }
  return state;
}
