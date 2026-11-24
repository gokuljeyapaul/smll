/**
 * R2-3 (issue #78, plan S9/A38): the storage-offer decision logic — PURE,
 * unit-tested, and the single place that decides whether the 397 MB
 * tidy-up model download may be offered at all.
 *
 * The honest inputs (everything measured on this engine matrix, see
 * docs/evidence/R2-3/env-probe.json):
 *  - probeOk: the model-store write/read probe (OPFS or Cache Storage —
 *    src/model/store.ts). False → the browser cannot store the model at
 *    all (the existing 'unsupported' path).
 *  - quotaBytes: navigator.storage.estimate().quota (a READ, allowed at
 *    any time). null when the browser does not implement estimate().
 *  - cacheWasLost: the app's OWN continuity evidence — the app-shell cache
 *    holds a "model verified here once" record and the model store works,
 *    but the model file is gone. That is a DETECTED lost cache (eviction,
 *    a WebView wipe, partitioned storage): re-offering a 397 MB download
 *    into storage that just proved it loses the model is the anti-pattern
 *    issue #78 bans.
 *
 * What is NOT used as a refusal signal: navigator.storage.persist() ===
 * false. Measured on this matrix it is false in EVERY Chromium context —
 * persistent profile, incognito and ephemeral alike (env-probe.json) — so
 * refusing on it would block every legitimate download while detecting
 * nothing. persist() IS requested at the user's opt-in (real browsers may
 * grant it; the headless matrix denies it — recorded honestly), but the
 * offer/refuse decision rests on the three signals above.
 */

import { PINNED_MODEL, testStorageOverride } from './manifest';

export type StorageOfferVerdict = 'unavailable' | 'no-room' | 'volatile' | 'offer';

export interface StorageFacts {
  /** The model-store write/read probe result. */
  probeOk: boolean;
  /** navigator.storage.estimate().quota in bytes; null when unknown. */
  quotaBytes: number | null;
  /** The app detected the model cache was lost since the last verified
   * download (continuity record present, store works, model gone). */
  cacheWasLost: boolean;
}

/** Peak disk need during a download: the temp plus the final file during
 * the promote (measured on the OPFS backend; Cache Storage holds the temp
 * in memory). Conservative for both backends. */
export const ROOM_HEADROOM_FACTOR = 2;

export function roomBarBytes(neededBytes: number): number {
  return neededBytes * ROOM_HEADROOM_FACTOR;
}

/** Honest, non-technical size label from the pinned manifest (never a
 * magic number: the unit test recomputes it the same way). */
export function formatMiB(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(0);
}

/** The kind refusals (fail closed, naming what still works — the same
 * voice as the S3 banners; never user content). */
export const STORAGE_REFUSAL_MESSAGES: Record<'no-room' | 'volatile', string> = {
  'no-room': `There isn't enough room on this device for the tidy-up model (about ${formatMiB(
    PINNED_MODEL.sizeBytes,
  )} MiB), so the download isn't offered. Everything else still works — pick your screenshot and PostClip cleans it up with the standard rules.`,
  volatile:
    "This browser clears the tidy-up model's storage between sessions (a private window or a restricted web view does this), so the download isn't offered. Everything else still works — pick your screenshot and PostClip cleans it up with the standard rules.",
};

/**
 * The offer/refuse decision. Order (unit-pinned):
 *   1. probeOk false            → 'unavailable' (cannot store at all)
 *   2. quota below the room bar → 'no-room'    (the concrete, actionable
 *                                            refusal wins when both apply)
 *   3. cacheWasLost             → 'volatile'  (a detected lost cache)
 *   4. otherwise                → 'offer'
 */
export function decideStorageOffer(facts: StorageFacts, neededBytes: number): StorageOfferVerdict {
  if (!facts.probeOk) return 'unavailable';
  if (facts.quotaBytes !== null && facts.quotaBytes < roomBarBytes(neededBytes)) return 'no-room';
  if (facts.cacheWasLost) return 'volatile';
  return 'offer';
}

/**
 * The fresh-start cache check plan (A37/A38): the cheap check is size +
 * the recorded sha256 marker; the 397 MB re-hash runs ONLY when the
 * marker is missing (a cache from before markers, or a wiped sidecar).
 *
 *   size + marker both match the pin → 'trust'  (no re-hash on launch)
 *   size matches, marker missing      → 'rehash' (one-time verification,
 *                                          then the marker is written)
 *   marker names another pin/size     → 'purge'  (stale — fail closed)
 *   size mismatch                     → 'purge'
 */
export type CacheCheckPlan = 'trust' | 'rehash' | 'purge';

export interface CacheCheckFacts {
  /** The cached entry's size equals the pinned size. */
  sizeMatches: boolean;
  /** The verified marker exists in the model store. */
  markerPresent: boolean;
  /** The marker's sha256 (and size) match the pinned manifest. */
  markerMatches: boolean;
}

export function planCacheCheck(facts: CacheCheckFacts): CacheCheckPlan {
  if (!facts.sizeMatches) return 'purge';
  if (!facts.markerPresent) return 'rehash';
  return facts.markerMatches ? 'trust' : 'purge';
}

/**
 * The measured storage quota (a READ — allowed at any time, unlike
 * persist() which is requested only at the user's opt-in). Returns null
 * when the browser does not implement estimate(). The R2-3 test-only
 * ?testStorage=no-room override forces the estimate below the room bar
 * (test builds only — A29 eliminates this branch from production).
 */
export async function measureStorageQuota(neededBytes: number): Promise<number | null> {
  if (testStorageOverride() === 'no-room') {
    return roomBarBytes(neededBytes) - 1;
  }
  try {
    const estimate = await navigator.storage?.estimate?.();
    return estimate?.quota ?? null;
  } catch {
    return null;
  }
}

/** The volatile-storage signal (test-only override in test builds; false in
 * production unless the platform reports it). */
export function storageVolatileSignal(): boolean {
  return testStorageOverride() === 'volatile';
}
