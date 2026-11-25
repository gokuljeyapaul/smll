/**
 * ModelManager (S3 — UC08/UC09/UC14): download the pinned model ONCE,
 * verify its sha256 BEFORE it enters the cache, keep it in the model cache
 * (the plan's second allowed persistence — OPFS or Cache Storage, selected
 * by a real capability probe, see store.ts), and fall back cleanly (purged,
 * banner, OCR + rules still working) on every failure.
 *
 * Fail-closed rules the manager enforces:
 *  - the bytes NEVER reach the cache key unless size AND sha256 both match
 *    the pinned manifest (A13): chunks stream into a temp, verification
 *    gates the promote;
 *  - on any failure the temp is discarded and the cache cleared (A13);
 *  - a cached model is found by reading the store only — checking it never
 *    touches the network (A14);
 *  - an interrupted download resumes with a Range request when the server
 *    supports it, and restarts cleanly from zero when it does not (A12).
 */

import { probeModelCapabilities, type ModelCapabilities } from './capability';
import { checkIntegrity, planResume } from './download';
import { PINNED_MODEL, testModelUrlOverride, type PinnedModel } from './manifest';
import { openModelStore, type ModelStore } from './store';
import { Sha256Incremental } from './sha256';
import { nextModelState, type ModelEvent, type ModelFailReason, type ModelState } from './state';
import { measureStorageQuota, planCacheCheck, roomBarBytes } from './storage-policy';

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
  store?: ModelStore | null;
  probe?: () => Promise<ModelCapabilities>;
  maxAttempts?: number;
  /** Download inactivity watchdog (no chunk for this long => abort + resume). */
  inactivityTimeoutMs?: number;
}

export const INITIAL_MODEL_PROGRESS: ModelProgress = {
  state: 'absent',
  receivedBytes: 0,
  totalBytes: PINNED_MODEL.sizeBytes,
  attemptsUsed: 0,
  reason: null,
};

/** Internal fail-closed signal: stop everything, purge, end `failed`. */
class ModelFlowError extends Error {
  constructor(readonly reason: ModelFailReason) {
    super(`model flow failed: ${reason}`);
  }
}

export class ModelManager {
  private readonly manifest: PinnedModel;
  private readonly fetchImpl: typeof fetch;
  private readonly providedStore: ModelStore | null;
  private readonly probe: () => Promise<ModelCapabilities>;
  private readonly maxAttempts: number;
  private readonly inactivityTimeoutMs: number;
  private progress: ModelProgress = { ...INITIAL_MODEL_PROGRESS };
  private listeners = new Set<ModelListener>();
  private inFlight: Promise<void> | null = null;
  private lastEmittedBytes = 0;
  private lastPaintAt = 0;
  private store: ModelStore | null = null;

  constructor(options: ModelManagerOptions = {}) {
    this.manifest = options.manifest ?? PINNED_MODEL;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.providedStore = options.store ?? null;
    this.probe = options.probe ?? probeModelCapabilities;
    // 6 (was 3): CI runners intermittently stall the fetch handshake in some
    // browser contexts (Chromium's network stack never hands the body to the
    // renderer); the 20 s inactivity watchdog bounds each stalled attempt, and
    // wire logs show retries DO recover in most such contexts — the budget is
    // raised so one unlucky context stops killing a whole CI run.
    this.maxAttempts = options.maxAttempts ?? 6;
    this.inactivityTimeoutMs = options.inactivityTimeoutMs ?? 20_000;
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

  /** Apply one state-machine event (+ progress patch) and notify. */
  private apply(event: ModelEvent, patch: Partial<ModelProgress> = {}): void {
    this.progress = {
      ...this.progress,
      ...patch,
      state: nextModelState(this.progress.state, event),
    };
    this.lastEmittedBytes = this.progress.receivedBytes;
    for (const listener of [...this.listeners]) {
      listener(this.progress);
    }
  }

  /** Chunk-level progress, throttled to ~200 updates per download. */
  private emitProgress(receivedBytes: number, attemptsUsed: number): Promise<void> {
    const threshold = Math.max(1, Math.floor(this.progress.totalBytes / 200));
    if (receivedBytes - this.lastEmittedBytes < threshold) return Promise.resolve();
    this.apply({ type: 'DOWNLOAD_START' }, { receivedBytes, attemptsUsed });
    // Yield to the renderer every ~250 ms so each committed state actually
    // PAINTS: React otherwise batches the whole read loop into one frame and
    // the bar would jump 0→100 without the user ever seeing it move (observed
    // in WebKit, whose fetch delivers ~15 MiB chunks back to back).
    const now = Date.now();
    if (now - this.lastPaintAt < 250) return Promise.resolve();
    this.lastPaintAt = now;
    return new Promise<void>((resolve) => {
      if (typeof requestAnimationFrame === 'function') {
        // Never gate the READ LOOP on the compositor alone: headless CI
        // contexts can starve requestAnimationFrame for minutes on loaded
        // runners (observed 2026-11-23: two full 397 MB responses handed to
        // the browser, then a 4-minute silent stall mid-download — the real
        // cause of the rotating a12/a14/a21 CI flakes). The paint yield races
        // a short timeout so a starved frame delays progress ~50 ms, not the
        // whole download.
        let settled = false;
        const settle = () => {
          if (!settled) {
            settled = true;
            resolve();
          }
        };
        requestAnimationFrame(() => settle());
        setTimeout(settle, 50);
      } else {
        resolve(); // non-browser test environments
      }
    });
  }

  /** The cache key: content-addressed by the pinned sha256. */
  private cacheKey(): string {
    return `model-${this.manifest.sha256}.gguf`;
  }

  /**
   * R2-3 (A37): the verified sha256 marker — a tiny JSON record in the SAME
   * model cache as the weights ({ sha256, sizeBytes, verifiedAt }). It is
   * what makes the fresh-start check CHEAP: size + marker match → trust,
   * with no 397 MB re-hash on launch; a missing marker costs one re-hash
   * (a cache from before markers), then it is written. Metadata only —
   * never model bytes, never user content.
   */
  private markerKey(): string {
    return `model-${this.manifest.sha256}.verified.json`;
  }

  private markerPayload(): { sha256: string; sizeBytes: number; verifiedAt: string } {
    return {
      sha256: this.manifest.sha256,
      sizeBytes: this.manifest.sizeBytes,
      verifiedAt: new Date().toISOString(),
    };
  }

  /** The download URL: the pinned one, or the test override in test builds. */
  private downloadUrl(): string {
    return testModelUrlOverride() ?? this.manifest.url;
  }

  /** Resolve the backend once (injectable for unit tests). */
  private async resolveStore(): Promise<ModelStore | null> {
    this.store ??= this.providedStore ?? (await openModelStore());
    return this.store;
  }

  /** Probe + cache check; never network. Absent/ready/unsupported result.
   *
   * R2-3 (A37): the fresh-start cache check is CHEAP — size plus the
   * recorded sha256 marker (planCacheCheck: trust / rehash / purge). The
   * 397 MB re-hash runs only when the marker is missing (a cache from
   * before markers); a mismatch fails closed to absent. */
  async check(): Promise<void> {
    const caps = await this.probe();
    if (!caps.supported) {
      this.apply({ type: 'PROBE_FAILED' }, { reason: 'unsupported' });
      return;
    }
    this.apply({ type: 'PROBE_OK' }, { reason: null });
    const store = await this.resolveStore();
    if (!store) {
      this.apply({ type: 'PROBE_FAILED' }, { reason: 'unsupported' });
      return;
    }
    const size = await store.size(this.cacheKey());
    if (size !== this.manifest.sizeBytes) return; // honestly absent
    let markerPresent = false;
    let markerMatches = false;
    const markerRaw = await store.readText(this.markerKey());
    if (markerRaw !== null) {
      markerPresent = true;
      try {
        const marker = JSON.parse(markerRaw) as { sha256?: unknown; sizeBytes?: unknown };
        markerMatches =
          marker.sha256 === this.manifest.sha256 && marker.sizeBytes === this.manifest.sizeBytes;
      } catch {
        markerMatches = false; // unparseable marker — untrusted
      }
    }
    const plan = planCacheCheck({ sizeMatches: true, markerPresent, markerMatches });
    if (plan === 'trust') {
      this.apply({ type: 'CACHE_HIT' }, { receivedBytes: this.manifest.sizeBytes });
      return;
    }
    if (plan === 'rehash') {
      // One-time verification for a cache that predates markers: hash the
      // cached bytes; on match write the marker and land ready, else purge
      // and stay honestly absent (fail closed — a size-matching but
      // unverified file is never trusted as "ready").
      const bytes = await store.read(this.cacheKey());
      if (bytes) {
        const hasher = new Sha256Incremental();
        hasher.update(bytes);
        if (hasher.digestHex() === this.manifest.sha256) {
          try {
            await store.putText(this.markerKey(), JSON.stringify(this.markerPayload()));
          } catch {
            // the marker is an optimization: its absence only costs the
            // next launch the same one-time re-hash
          }
          this.apply({ type: 'CACHE_HIT' }, { receivedBytes: this.manifest.sizeBytes });
          return;
        }
      }
      await store.clear();
      return;
    }
    // purge: a marker that does not match this pin is stale — fail closed.
    await store.clear();
  }

  /**
   * The full download flow (single flight): probe → cache short-circuit →
   * resumable download, streamed into the store temp while hashing →
   * size+sha256 verification → promote into the cache (only on match).
   * Any failure purges and ends `failed`.
   */
  async download(): Promise<void> {
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.runDownload();
    try {
      await this.inFlight;
    } finally {
      this.inFlight = null;
    }
  }

  private async runDownload(): Promise<void> {
    // The capability probe gates everything (A13 unsupported-browser path).
    const caps = await this.probe();
    if (!caps.supported) {
      this.apply({ type: 'PROBE_FAILED' }, { reason: 'unsupported' });
      return;
    }
    this.apply({ type: 'PROBE_OK' }, { reason: null });
    const store = await this.resolveStore();
    if (!store) {
      this.apply({ type: 'PROBE_FAILED' }, { reason: 'unsupported' });
      return;
    }

    // Cached (and size-verified) short-circuit: no network at all (A14).
    if ((await store.size(this.cacheKey())) === this.manifest.sizeBytes) {
      this.apply({ type: 'CACHE_HIT' }, { receivedBytes: this.manifest.sizeBytes });
      return;
    }

    // Fresh download. Start from a purged cache so a stale entry from an
    // older revision can never be served or measured as "the" model.
    await store.clear();
    await store.discardTemp();
    const url = this.downloadUrl();
    const hasher = new Sha256Incremental();
    let received = 0;

    // R2-3 (A37): request persistent storage at the USER'S OPT-IN — this
    // method only ever runs from the download button, never at load. Best
    // effort by design: real browsers may grant the guarantee; this
    // headless matrix denies it in EVERY context (measured —
    // docs/evidence/R2-3/env-probe.json), which is exactly why the offer
    // decision (storage-policy.ts) does NOT key on the persist() result.
    try {
      const persistFn = navigator.storage?.persist;
      if (typeof persistFn === 'function') {
        const granted = await persistFn.call(navigator.storage);
        console.info(`postclip-model: persist() requested at the download opt-in (granted=${String(granted)})`);
      } else {
        console.info('postclip-model: persist() unavailable in this browser - not requested');
      }
    } catch {
      // unsupported storage manager — best effort, never fatal
    }
    // Optimistic until disproven: a 206 proves Range support, a 200 that
    // answers a Range request disproves it (then a restart is the only way).
    let rangesUsable = true;

    this.apply(
      { type: 'DOWNLOAD_START' },
      { receivedBytes: 0, totalBytes: this.manifest.sizeBytes, attemptsUsed: 0, reason: null },
    );

    // R2-3 (A38): the storage estimate is checked against the need BEFORE
    // any byte is fetched (the room bar covers the promote's peak: temp +
    // final). Not enough room → the kind refusal (GIVE_UP lands 'failed'
    // from the 'downloading' state), zero model bytes.
    const quota = await measureStorageQuota(this.manifest.sizeBytes);
    if (quota !== null && quota < roomBarBytes(this.manifest.sizeBytes)) {
      await store.discardTemp();
      await store.clear();
      this.apply({ type: 'GIVE_UP' }, { reason: 'no-room' });
      return;
    }

    // Inactivity watchdog (defense in depth): a download body that delivers no
    // chunk for 20 s is aborted and flows into the existing resume path
    // (Range from `received`, or a clean restart, or give-up — fail closed).
    const INACTIVITY_MS = this.inactivityTimeoutMs;

    for (let attempt = 1; ; attempt++) {
      let watchdog: ReturnType<typeof setTimeout> | null = null;
      const controller = new AbortController();
      /** Reset the no-progress watchdog (any observable event counts). */
      const pokeWatchdog = () => {
        if (watchdog !== null) clearTimeout(watchdog);
        watchdog = setTimeout(() => controller.abort(), INACTIVITY_MS);
      };
      try {
        const headers = new Headers();
        if (received > 0) headers.set('range', `bytes=${received}-`);
        // The watchdog spans the FETCH HANDSHAKE too: on loaded CI runners the
        // observed stall is the fetch promise itself never settling after the
        // server has handed the full body to the browser's network stack (CI
        // wire log: full 397 MB responses served, then NO retry of any kind
        // — the read-loop-only watchdog of the first fix never got control).
        pokeWatchdog();
        const res = await this.fetchImpl(url, {
          headers,
          cache: 'no-store',
          credentials: 'omit',
          redirect: 'follow',
          signal: controller.signal,
        });
        pokeWatchdog();
        if (!res.ok) {
          await store.discardTemp();
          await store.clear();
          this.apply({ type: 'HTTP_ERROR' }, { reason: 'http-error' });
          return;
        }
        if (received > 0 && res.status === 206) {
          rangesUsable = true; // the server honored the resume
        } else if (received > 0 && res.status === 200) {
          // The server ignored the Range header: restart cleanly from zero.
          rangesUsable = false;
          await store.discardTemp();
          hasher.reset();
          received = 0;
          this.apply({ type: 'DOWNLOAD_START' }, { receivedBytes: 0, attemptsUsed: attempt });
        }
        const reader = res.body?.getReader();
        if (!reader) {
          throw new ModelFlowError('network-error'); // no body to verify — fail closed
        }
        for (;;) {
          // No event (fetch settled, chunk delivered) within the window →
          // abort → resume/restart via the catch path.
          pokeWatchdog();
          const read = await reader.read();
          const { done, value } = read;
          if (done) break;
          hasher.update(value);
          await store.appendTemp(value);
          received += value.length;
          await this.emitProgress(received, attempt);
        }
        this.apply({ type: 'STREAM_COMPLETE' }, { receivedBytes: received, attemptsUsed: attempt });

        // Verified BEFORE cached (A12/A13): size first, then the pinned sha256.
        const verdict = checkIntegrity({
          receivedBytes: received,
          expectedBytes: this.manifest.sizeBytes,
          digestHex: hasher.digestHex(),
          expectedSha256: this.manifest.sha256,
        });
        if (!verdict.ok || verdict.reason !== null) {
          await store.discardTemp();
          await store.clear();
          this.apply({ type: 'VERIFY_FAILED' }, { reason: verdict.reason });
          return;
        }
        try {
          await store.promoteTemp(this.cacheKey());
        } catch {
          await store.discardTemp();
          await store.clear();
          this.apply({ type: 'GIVE_UP' }, { reason: 'storage-error' });
          return;
        }
        // R2-3 (A37): record the verified sha256 marker so the NEXT launch
        // trusts the cache cheaply (size + marker; no 397 MB re-hash).
        try {
          await store.putText(this.markerKey(), JSON.stringify(this.markerPayload()));
        } catch {
          // best effort: a missing marker only costs the next launch a
          // one-time re-hash before it trusts the cache
        }
        this.apply({ type: 'VERIFY_OK' }, { receivedBytes: received });
        return;
      } catch (err) {
        if (watchdog !== null) clearTimeout(watchdog);
        if (err instanceof ModelFlowError) {
          await store.discardTemp();
          await store.clear();
          this.apply({ type: 'GIVE_UP' }, { reason: err.reason });
          return;
        }
        // A dropped connection (or any unexpected error): resume/restart
        // while the budget lasts, give up afterwards (fail closed).
        const plan = planResume({
          bytesReceived: received,
          attemptsUsed: attempt,
          maxAttempts: this.maxAttempts,
          serverSupportsRanges: rangesUsable,
        });
        if (plan.action === 'give-up') {
          await store.discardTemp();
          await store.clear();
          this.apply({ type: 'GIVE_UP' }, { reason: 'network-error', attemptsUsed: attempt });
          return;
        }
        if (plan.action === 'restart') {
          await store.discardTemp();
          hasher.reset();
          received = 0;
        }
        // 'resume' keeps the temp bytes/hash state and continues from `received`.
        this.apply({ type: 'DOWNLOAD_START' }, { receivedBytes: received, attemptsUsed: attempt });
      }
    }
  }

  /** Drop the cache entry and any staged bytes (A13 "purged"). */
  async purge(): Promise<void> {
    const store = await this.resolveStore();
    if (store) {
      await store.discardTemp();
      await store.clear();
    }
    this.apply({ type: 'PURGED' }, { receivedBytes: 0, reason: null });
  }

  /** Read the cached model bytes (S4 runtime entry point); null if absent. */
  async readCached(): Promise<Uint8Array | null> {
    const store = await this.resolveStore();
    if (!store) return null;
    const bytes = await store.read(this.cacheKey());
    if (bytes && bytes.length !== this.manifest.sizeBytes) return null; // stale — not trusted
    return bytes;
  }
}

/** The app-wide singleton (one model, one cache, one download at a time). */
export const modelManager = new ModelManager();
