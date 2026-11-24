// @vitest-environment node
/**
 * ModelManager unit tests (S3 — A12/A13/A14) with stubbed fetch/store/probe
 * boundaries (the e2e suite proves the same contract against the real
 * browsers, the real pinned file and the real OPFS/Cache-Storage backends):
 * the pinned model downloads with streamed progress into the store temp,
 * is verified size+sha256 BEFORE the promote that moves it into the cache,
 * survives interrupted downloads via Range resume or a clean restart, fails
 * closed with a purge on every bad variant, and a cached model is found
 * without any network.
 */
import { createHash, randomBytes } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ModelManager, type ModelProgress } from './manager';
import type { ModelStore } from './store';
import type { PinnedModel } from './manifest';

/** Fresh ArrayBuffer-backed copy so Blob/Response accept the bytes. */
const u8 = (bytes: Uint8Array): Uint8Array<ArrayBuffer> => new Uint8Array(bytes);

// ---- fake boundaries -----------------------------------------------------------

/** In-memory ModelStore: temp accumulates appends; promote is verify-gated
 *  by the MANAGER, so the fake records every call for the assertions. */
class FakeModelStore implements ModelStore {
  readonly kind = 'cache-storage' as const;
  temp: Uint8Array[] = [];
  entries = new Map<string, Uint8Array>();
  promotes: string[] = [];
  discards = 0;
  clears = 0;

  async appendTemp(chunk: Uint8Array): Promise<void> {
    this.temp.push(chunk);
  }
  async discardTemp(): Promise<void> {
    this.discards += 1;
    this.temp = [];
  }
  async promoteTemp(key: string): Promise<void> {
    const total = this.temp.reduce((n, c) => n + c.length, 0);
    const bytes = new Uint8Array(total);
    let at = 0;
    for (const c of this.temp) {
      bytes.set(c, at);
      at += c.length;
    }
    this.entries.set(key, bytes);
    this.promotes.push(key);
    this.temp = [];
  }
  async size(key: string): Promise<number | null> {
    return this.entries.get(key)?.length ?? null;
  }
  async read(key: string): Promise<Uint8Array | null> {
    return this.entries.get(key) ?? null;
  }
  async clear(): Promise<void> {
    this.clears += 1;
    this.entries.clear();
    this.temp = [];
  }
  async putText(key: string, text: string): Promise<void> {
    this.entries.set(key, u8(new TextEncoder().encode(text)));
  }
  async readText(key: string): Promise<string | null> {
    const bytes = this.entries.get(key);
    return bytes ? new TextDecoder().decode(bytes) : null;
  }
}

interface FetchCall {
  url: string;
  range: string | null;
}

function chunked(chunks: Uint8Array[], init?: ResponseInit): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(c);
      controller.close();
    },
  });
  return new Response(stream, init);
}

function killingStream(chunks: Uint8Array[]): Response {
  // Deliver every chunk on pull, then error on the NEXT read: enqueueing
  // and immediately erroring would discard the unread queue (streams spec),
  // so this is the only deterministic "connection dropped mid-body" fake.
  let i = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i < chunks.length) {
        controller.enqueue(chunks[i++]!);
      } else {
        controller.error(new TypeError('simulated connection drop'));
      }
    },
  });
  return new Response(stream);
}

function fakeFetch(script: { make: (init?: RequestInit) => Response }[]) {
  const calls: FetchCall[] = [];
  const impl = (url: string | RequestInfo, init?: RequestInit): Promise<Response> => {
    const range = init?.headers instanceof Headers ? init.headers.get('range') : null;
    calls.push({ url: String(url), range });
    return Promise.resolve(script[Math.min(calls.length - 1, script.length - 1)].make(init));
  };
  return { impl, calls };
}

// ---- a small fake pinned model ------------------------------------------------

function makeFakeManifest(): {
  manifest: PinnedModel;
  bytes: Uint8Array<ArrayBuffer>;
  chunks: Uint8Array<ArrayBuffer>[];
} {
  const bytes = u8(randomBytes(4000));
  const manifest: PinnedModel = {
    id: 'fake-model',
    repo: 'test/repo',
    revision: '0'.repeat(40),
    filename: 'fake.gguf',
    url: 'https://example.invalid/fake.gguf',
    sha256: createHash('sha256').update(bytes).digest('hex'),
    sizeBytes: bytes.length,
    format: 'gguf',
    license: 'Apache-2.0',
    licenseUrl: 'https://example.invalid/LICENSE',
    licenseNote: 'unit-test fixture manifest',
  };
  return {
    manifest,
    bytes,
    chunks: [bytes.subarray(0, 1000), bytes.subarray(1000, 2000), bytes.subarray(2000, 3000), bytes.subarray(3000)],
  };
}

const PROBE_OK = async () => ({ supported: true, reasons: [] as string[] });
const PROBE_NO = async () => ({ supported: false, reasons: ['test override'] as string[] });

function freshManager(
  model: ReturnType<typeof makeFakeManifest> = makeFakeManifest(),
  overrides: Partial<ConstructorParameters<typeof ModelManager>[0]> = {},
) {
  const store = new FakeModelStore();
  const manager = new ModelManager({
    manifest: model.manifest,
    store,
    probe: PROBE_OK,
    ...overrides,
  });
  return { manager, manifest: model.manifest, bytes: model.bytes, chunks: model.chunks, store };
}

const keyOf = (manifest: PinnedModel): string => `model-${manifest.sha256}.gguf`;

describe('ModelManager — download, verify, cache, fallback (S3)', () => {
  beforeEach(() => {
    expect(globalThis.caches).toBeUndefined(); // node env: nothing global leaks in
  });

  it('downloads the pinned file with streaming progress and ends ready (A12)', async () => {
    const model = makeFakeManifest();
    const fetcher = fakeFetch([{ make: () => chunked(model.chunks) }]);
    const { manager, manifest, bytes, store } = freshManager(model, {
      fetchImpl: fetcher.impl as typeof fetch,
    });

    const seen: ModelProgress[] = [];
    manager.subscribe((p) => seen.push({ ...p }));
    await manager.download();

    expect(manager.getStatus().state).toBe('ready');
    expect(manager.getStatus().receivedBytes).toBe(bytes.length);
    expect(fetcher.calls.map((c) => c.url)).toEqual([manifest.url]);
    // progress streamed monotonically through the download lifecycle
    // 'downloading' → 'verifying' → 'ready' (the initial probe emissions in
    // 'absent' precede the lifecycle and are not part of it).
    const downloading = seen.filter((p) => p.state === 'downloading');
    expect(downloading.length, 'chunk-level progress updates').toBeGreaterThan(1);
    const received = downloading.map((p) => p.receivedBytes);
    expect([...received].sort((a, b) => a - b)).toEqual(received);
    const lifecycleStart = seen.findIndex((p) => p.state === 'downloading');
    expect(
      new Set(seen.slice(lifecycleStart).map((p) => p.state)),
      'the observed lifecycle is exactly downloading → verifying → ready',
    ).toEqual(new Set(['downloading', 'verifying', 'ready']));
    // verified BEFORE cached: exactly one promote carries the exact pinned bytes
    expect(store.promotes).toEqual([keyOf(manifest)]);
    expect(Buffer.compare(Buffer.from(store.entries.get(keyOf(manifest))!), Buffer.from(bytes))).toBe(0);
  });

  it('a checksum mismatch purges the cache and ends failed (A13)', async () => {
    const model = makeFakeManifest();
    const bad = u8(model.bytes);
    bad[123] ^= 0xff;
    const fetcher = fakeFetch([{ make: () => chunked([bad]) }]);
    const { manager, store } = freshManager(model, { fetchImpl: fetcher.impl as typeof fetch });

    await manager.download();

    const status = manager.getStatus();
    expect(status.state).toBe('failed');
    expect(status.reason).toBe('checksum-mismatch');
    // the bad file must be purged: temp discarded, cache cleared, nothing promoted
    expect(store.promotes).toEqual([]);
    expect(store.discards).toBeGreaterThan(0);
    expect(store.clears).toBeGreaterThan(0);
    expect([...store.entries.keys()]).toEqual([]);
  });

  it('a truncated file (stream ends short of the pinned size) fails closed with a purge (A13)', async () => {
    const model = makeFakeManifest();
    const fetcher = fakeFetch([
      { make: () => chunked([model.bytes.subarray(0, model.bytes.length - 500)]) },
    ]);
    const { manager, store } = freshManager(model, { fetchImpl: fetcher.impl as typeof fetch });

    await manager.download();

    expect(manager.getStatus().state).toBe('failed');
    expect(manager.getStatus().reason).toBe('size-mismatch');
    expect(store.promotes).toEqual([]);
    expect(store.discards).toBeGreaterThan(0);
    expect(store.clears).toBeGreaterThan(0);
  });

  it('an HTTP error (404) fails closed without caching (A13)', async () => {
    const fetcher = fakeFetch([{ make: () => new Response('nope', { status: 404 }) }]);
    const { manager, store } = freshManager(undefined, { fetchImpl: fetcher.impl as typeof fetch });

    await manager.download();

    expect(manager.getStatus().state).toBe('failed');
    expect(manager.getStatus().reason).toBe('http-error');
    expect(store.promotes).toEqual([]);
    expect(store.clears).toBeGreaterThan(0);
  });

  it('an interrupted download RESUMES with a Range request and ends ready (A12)', async () => {
    const model = makeFakeManifest();
    const first = [model.bytes.subarray(0, 1000), model.bytes.subarray(1000, 2000)]; // then killed
    const fetcher = fakeFetch([
      { make: () => killingStream(first) },
      { make: () => chunked([model.bytes.subarray(2000)], { status: 206 }) },
    ]);
    const { manager, manifest, bytes, store } = freshManager(model, {
      fetchImpl: fetcher.impl as typeof fetch,
    });

    await manager.download();

    expect(manager.getStatus().state).toBe('ready');
    expect(fetcher.calls).toHaveLength(2);
    expect(fetcher.calls[0]!.range).toBeNull();
    expect(fetcher.calls[1]!.range).toBe(`bytes=${2000}-`); // resumed from 2000, not from zero
    // the temp continued across the resume; the promote carries the full bytes
    expect(store.discards).toBe(1); // only the fresh-start cleanup — the resume kept the temp
    expect(Buffer.compare(Buffer.from(store.entries.get(keyOf(manifest))!), Buffer.from(bytes))).toBe(0);
  });

  it('a server that ignores Range makes the app restart cleanly from zero (A12)', async () => {
    const model = makeFakeManifest();
    const fetcher = fakeFetch([
      { make: () => killingStream([model.bytes.subarray(0, 1000)]) },
      { make: () => chunked([model.bytes], { status: 200 }) }, // full 200, no 206
    ]);
    const { manager, manifest, bytes, store } = freshManager(model, {
      fetchImpl: fetcher.impl as typeof fetch,
    });

    await manager.download();

    expect(manager.getStatus().state).toBe('ready');
    expect(manager.getStatus().receivedBytes).toBe(bytes.length);
    expect(store.discards).toBe(2); // fresh-start cleanup + the restart's temp drop
    expect(Buffer.compare(Buffer.from(store.entries.get(keyOf(manifest))!), Buffer.from(bytes))).toBe(0);
  });

  it('gives up after the attempt budget and fails closed with a purge (A12/A13)', async () => {
    // Explicit small budget: this test pins the give-up behavior, not the
    // default budget (raised 3 -> 6 for CI-stall recovery; see manager.ts).
    const fetcher = fakeFetch([{ make: () => killingStream([u8(randomBytes(10))]) }]);
    const { manager, store } = freshManager(undefined, { fetchImpl: fetcher.impl as typeof fetch, maxAttempts: 2 });

    await manager.download();

    expect(manager.getStatus().state).toBe('failed');
    expect(manager.getStatus().reason).toBe('network-error');
    expect(fetcher.calls).toHaveLength(2); // the explicit maxAttempts
    expect(store.promotes).toEqual([]);
    expect(store.discards).toBeGreaterThan(0);
    expect(store.clears).toBeGreaterThan(0);
  });

  it('a cached model is ready without any network (A14)', async () => {
    const model = makeFakeManifest();
    const fetcher = fakeFetch([{ make: () => chunked(model.chunks) }]);
    const { manager, manifest, store } = freshManager(model, {
      fetchImpl: fetcher.impl as typeof fetch,
    });
    await store.promoteTemp(keyOf(manifest));
    await store.appendTemp(model.bytes);
    await store.promoteTemp(keyOf(manifest));

    await manager.check();
    expect(manager.getStatus().state).toBe('ready');
    await manager.download(); // a download request short-circuits on the cache
    expect(fetcher.calls).toHaveLength(0);
  });

  it('a stale cached entry with the wrong size is re-downloaded and replaced', async () => {
    const model = makeFakeManifest();
    const fetcher = fakeFetch([{ make: () => chunked(model.chunks) }]);
    const { manager, manifest, bytes, store } = freshManager(model, {
      fetchImpl: fetcher.impl as typeof fetch,
    });
    // stale entry: right key, wrong size (an older revision's leftovers)
    await store.appendTemp(u8(randomBytes(500)));
    await store.promoteTemp(keyOf(manifest));
    await expect(store.size(keyOf(manifest))).resolves.toBe(500);

    await manager.download();

    expect(manager.getStatus().state).toBe('ready');
    expect(fetcher.calls).toHaveLength(1); // the stale size forced a re-download
    expect(store.clears).toBeGreaterThan(0); // the stale entry was purged first
    expect(Buffer.compare(Buffer.from(store.entries.get(keyOf(manifest))!), Buffer.from(bytes))).toBe(0);
  });

  it('an unsupported browser ends unsupported without any fetch (A13)', async () => {
    const fetcher = fakeFetch([{ make: () => chunked([u8(randomBytes(1))]) }]);
    const { manager, store } = freshManager(undefined, {
      probe: PROBE_NO,
      fetchImpl: fetcher.impl as typeof fetch,
    });

    await manager.check();
    expect(manager.getStatus().state).toBe('unsupported');

    await manager.download();
    expect(manager.getStatus().state).toBe('unsupported');
    expect(fetcher.calls).toHaveLength(0);
    expect(store.promotes).toEqual([]);
  });

  it('a missing model store (no OPFS, no Cache Storage) ends unsupported (A13)', async () => {
    const fetcher = fakeFetch([{ make: () => chunked([u8(randomBytes(1))]) }]);
    const { manager } = freshManager(undefined, {
      store: null, // the real openModelStore() returning null
      fetchImpl: fetcher.impl as typeof fetch,
    });
    // probe says fine (WASM etc.) but no store backend exists
    await manager.check();
    expect(manager.getStatus().state).toBe('unsupported');
    expect(fetcher.calls).toHaveLength(0);
  });

  it('check() with no cache and a supported browser stays absent (no network)', async () => {
    const fetcher = fakeFetch([{ make: () => chunked([u8(randomBytes(1))]) }]);
    const { manager } = freshManager(undefined, { fetchImpl: fetcher.impl as typeof fetch });

    await manager.check();
    expect(manager.getStatus().state).toBe('absent');
    expect(fetcher.calls).toHaveLength(0);
  });

  it('readCached() returns the cached bytes (the S4 runtime entry point)', async () => {
    const model = makeFakeManifest();
    const fetcher = fakeFetch([{ make: () => chunked(model.chunks) }]);
    const { manager, bytes } = freshManager(model, { fetchImpl: fetcher.impl as typeof fetch });

    expect(await manager.readCached()).toBeNull();
    await manager.download();
    const cached = await manager.readCached();
    expect(cached).not.toBeNull();
    expect(Buffer.compare(Buffer.from(cached!), Buffer.from(bytes))).toBe(0);
  });

  it('concurrent download() calls are single-flight (one download, one promote)', async () => {
    const model = makeFakeManifest();
    const fetcher = fakeFetch([{ make: () => chunked(model.chunks) }]);
    const { manager, store } = freshManager(model, { fetchImpl: fetcher.impl as typeof fetch });

    await Promise.all([manager.download(), manager.download(), manager.download()]);

    expect(fetcher.calls).toHaveLength(1);
    expect(store.promotes).toHaveLength(1);
    expect(manager.getStatus().state).toBe('ready');
  });

  it('a failed download can be retried back to ready (the Try again path)', async () => {
    const model = makeFakeManifest();
    const fetcher = fakeFetch([
      { make: () => new Response('boom', { status: 500 }) },
      { make: () => chunked(model.chunks) },
    ]);
    const { manager, store } = freshManager(model, { fetchImpl: fetcher.impl as typeof fetch });

    await manager.download();
    expect(manager.getStatus().state).toBe('failed');
    await manager.download(); // retry
    expect(manager.getStatus().state).toBe('ready');
    expect(store.promotes).toHaveLength(1);
  });

  it('a starved requestAnimationFrame never freezes the download (CI stall fix)', async () => {
    // Observed on CI 2026-11-23: headless contexts can starve rAF for minutes
    // on loaded runners; the read loop used to block on the frame callback
    // and the whole download hung with the server having sent everything.
    // rAF defined but never firing must NOT stop the download.
    const model = makeFakeManifest();
    const fetcher = fakeFetch([{ make: () => chunked(model.chunks) }]);
    const { manager } = freshManager(model, { fetchImpl: fetcher.impl as typeof fetch });
    vi.stubGlobal('requestAnimationFrame', (() => 0) as typeof requestAnimationFrame);
    try {
      await manager.download();
      expect(manager.getStatus().state).toBe('ready'); // via the 50 ms paint-fallback
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('a fetch that never settles is aborted and retried (CI stall fix 2)', async () => {
    // The wire log of the failed PR-head run showed the sharper stall: the
    // server handed the full body to the browser, and the fetch promise
    // ITSELF never settled — no read, no error, no retry. The watchdog must
    // cover the handshake, not only the read loop.
    let delivered = 0;
    const hangingFetch = (init?: RequestInit): Promise<Response> => {
      if (delivered === 0) {
        delivered += 1;
        return new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal ?? null;
          if (signal?.aborted) {
            reject(new DOMException('Aborted', 'AbortError'));
            return;
          }
          signal?.addEventListener(
            'abort',
            () => reject(new DOMException('Aborted', 'AbortError')),
            { once: true },
          );
          // never resolves otherwise — the exact CI signature
        });
      }
      return Promise.resolve(chunked(model.chunks));
    };
    const model = makeFakeManifest();
    const calls: FetchCall[] = [];
    const impl = (url: string | RequestInfo, init?: RequestInit): Promise<Response> => {
      const range = init?.headers instanceof Headers ? init.headers.get('range') : null;
      calls.push({ url: String(url), range });
      return hangingFetch(init);
    };
    const { manager } = freshManager(model, {
      fetchImpl: impl as typeof fetch,
      inactivityTimeoutMs: 50,
    });

    await manager.download();
    expect(manager.getStatus().state).toBe('ready');
    expect(calls).toHaveLength(2); // hung handshake aborted once, then completed
  });

  it('a stalled download body is aborted and range-resumed (CI stall fix)', async () => {
    // Attempt 1 delivers 2 chunks (2000 bytes) then the read HANGS with no
    // error — the exact CI signature. The inactivity watchdog aborts, and
    // attempt 2 resumes with a Range from the received offset.
    const model = makeFakeManifest();
    let delivered = 0;
    const stalling = (init?: RequestInit): Response => {
      const signal = init?.signal ?? null;
      const stream = new ReadableStream<Uint8Array>({
        pull(controller) {
          if (delivered < 2) {
            controller.enqueue(model.chunks[delivered++]!);
            return;
          }
          // Hang until aborted; real fetch bodies reject on abort.
          if (signal?.aborted) {
            controller.error(new TypeError('simulated stall aborted'));
            return;
          }
          signal?.addEventListener(
            'abort',
            () => controller.error(new TypeError('simulated stall aborted')),
            { once: true },
          );
        },
      });
      return new Response(stream);
    };
    const fetcher = fakeFetch([
      { make: stalling },
      { make: () => chunked([model.chunks[2]!, model.chunks[3]!], { status: 206 }) },
    ]);
    const { manager } = freshManager(model, {
      fetchImpl: fetcher.impl as typeof fetch,
      inactivityTimeoutMs: 50,
    });

    await manager.download();
    expect(manager.getStatus().state).toBe('ready');
    expect(fetcher.calls).toHaveLength(2);
    expect(fetcher.calls[0]?.range).toBeNull();
    expect(fetcher.calls[1]?.range).toBe('bytes=2000-'); // resumed from the stall offset
  });
});
