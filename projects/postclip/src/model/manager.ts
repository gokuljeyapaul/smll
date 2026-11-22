/**
 * ModelManager (S3 — UC08/UC09/UC14): download the pinned model ONCE,
 * verify its sha256 BEFORE it enters the cache, keep it in the model cache
 * (Cache Storage — one of only two allowed persistences), and fall back
 * cleanly (purged, banner, OCR + rules still working) on every failure.
 *
 * Fail-closed rules the manager enforces:
 *  - the file NEVER enters the cache unless size AND sha256 both match the
 *    pinned manifest (A13);
 *  - on any failure the staged bytes are dropped and the cache entry is
 *    purged (A13);
 *  - a cached model is found by reading Cache Storage only — checking it
 *    never touches the network (A14);
 *  - an interrupted download resumes with a Range request when the server
 *    supports it, and restarts cleanly from zero when it does not (A12).
 */

import { probeModelCapabilities, type ModelCapabilities } from './capability';
import { checkIntegrity, planResume } from './download';
import { MODEL_CACHE_NAME, PINNED_MODEL, modelUrl, type PinnedModel } from './manifest';
import { Sha256Incremental } from './sha256';
import { nextModelState, type ModelFailReason, type ModelState } from './state';

export interface ModelProgress {
  state: ModelState;
  receivedBytes: number;
  totalBytes: number;
  attemptsUsed: number;
  /** Fail-closed reason code for failed/unsupported (never user content). */
  reason: ModelFailReason | null;
}

export type ModelListener = (progress: ModelProgress) => void;

export interface ModelManagerOptions {
  manifest?: PinnedModel;
  fetchImpl?: typeof fetch;
  cacheStorage?: CacheStorage;
  probe?: () => Promise<ModelCapabilities>;
  maxAttempts?: number;
}

export const INITIAL_MODEL_PROGRESS: ModelProgress = {
  state: 'absent',
  receivedBytes: 0,
  totalBytes: PINNED_MODEL.sizeBytes,
  attemptsUsed: 0,
  reason: null,
};

export class ModelManager {
  private readonly manifest: PinnedModel;
  private readonly fetchImpl: typeof fetch;
  private readonly cacheStorage: CacheStorage;
  private readonly probe: () => Promise<ModelCapabilities>;
  private readonly maxAttempts: number;
  private progress: ModelProgress = { ...INITIAL_MODEL_PROGRESS };
  private listeners = new Set<ModelListener>();
  private inFlight: Promise<void> | null = null;

  constructor(options: ModelManagerOptions = {}) {
    this.manifest = options.manifest ?? PINNED_MODEL;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.cacheStorage = options.cacheStorage ?? globalThis.caches;
    this.probe = options.probe ?? probeModelCapabilities;
    this.maxAttempts = options.maxAttempts ?? 3;
    void checkIntegrity;
    void planResume;
    void nextModelState;
    void MODEL_CACHE_NAME;
    void modelUrl;
    void Sha256Incremental;
  }

  /** Current status snapshot (poll-friendly for tests and the UI). */
  getStatus(): ModelProgress {
    return this.progress;
  }

  /** Subscribe to progress updates; returns an unsubscribe function. */
  subscribe(listener: ModelListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(next: Partial<ModelProgress>): void {
    this.progress = { ...this.progress, ...next };
    for (const listener of [...this.listeners]) {
      listener(this.progress);
    }
  }

  /**
   * Cheap startup check (A14: never network): probe capabilities, then look
   * for the cached model in Cache Storage. Updates the state to
   * unsupported / ready / absent accordingly.
   */
  async check(): Promise<void> {
    void this.cacheStorage;
    void this.probe;
    void this.manifest;
    void this.emit;
    // RED scaffold: no check behavior yet.
  }

  /**
   * The full download flow (single flight): probe → cache short-circuit →
   * resumable download with streamed hashing → size+sha256 verification →
   * cache (only on match). Any failure purges and ends `failed`.
   */
  async download(): Promise<void> {
    void this.inFlight;
    void this.fetchImpl;
    void this.maxAttempts;
    void this.emit;
    // RED scaffold: no download behavior yet — the state stays `absent`.
  }

  /** Drop the model cache entry and any staged bytes (A13 "purged"). */
  async purge(): Promise<void> {
    void this.cacheStorage;
    void this.emit;
    // RED scaffold: no purge behavior yet.
  }

  /** Read the cached model bytes (S4 runtime entry point); null if absent. */
  async readCached(): Promise<Uint8Array | null> {
    void this.cacheStorage;
    void this.manifest;
    return null;
  }
}

/** The app-wide singleton (one model, one cache, one download at a time). */
export const modelManager = new ModelManager();
