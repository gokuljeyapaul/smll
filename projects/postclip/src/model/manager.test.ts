// @vitest-environment node
/**
 * ModelManager unit tests (S3 — A12/A13/A14) with stubbed fetch/cache/probe
 * boundaries (the e2e suite proves the same contract against the real
 * browsers, the real pinned file and the real Cache Storage): the pinned
 * model downloads with progress, is verified size+sha256 BEFORE it enters
 * the cache, survives interrupted downloads via Range resume or a clean
 * restart, fails closed with a purge on every bad variant, and a cached
 * model is found without any network.
 */
import { createHash, randomBytes } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { ModelManager, type ModelProgress } from './manager';
import { MODEL_CACHE_NAME, type PinnedModel } from './manifest';

/** Fresh ArrayBuffer-backed copy so Blob/Response accept the bytes. */
const u8 = (bytes: Uint8Array): Uint8Array<ArrayBuffer> => new Uint8Array(bytes);

// ---- fake browser boundaries -------------------------------------------------

class FakeCache {
  puts: { url: string; bytes: Uint8Array }[] = [];
  entries = new Map<string, Uint8Array<ArrayBuffer>>();

  async put(url: string, response: Response): Promise<void> {
    const bytes = u8(new Uint8Array(await response.arrayBuffer()));
    this.entries.set(url, bytes);
    this.puts.push({ url, bytes });
  }
  async match(url: string): Promise<Response | undefined> {
    const bytes = this.entries.get(url);
    return bytes ? new Response(new Blob([bytes])) : undefined;
  }
  async keys(): Promise<Request[]> {
    return [...this.entries.keys()].map((u) => new Request(u));
  }
}

class FakeCacheStorage {
  caches = new Map<string, FakeCache>();
  deletedNames: string[] = [];

  async open(name: string): Promise<FakeCache> {
    let c = this.caches.get(name);
    if (!c) {
      c = new FakeCache();
      this.caches.set(name, c);
    }
    return c;
  }
  async delete(name: string): Promise<boolean> {
    this.deletedNames.push(name);
    return this.caches.delete(name);
  }
  async keys(): Promise<string[]> {
    return [...this.caches.keys()];
  }
  async has(name: string): Promise<boolean> {
    return this.caches.has(name);
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
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(c);
      controller.error(new TypeError('simulated connection drop'));
    },
  });
  return new Response(stream);
}

function fakeFetch(script: { make: () => Response }[]) {
  const calls: FetchCall[] = [];
  const impl = (url: string | RequestInfo, init?: RequestInit): Promise<Response> => {
    const range = init?.headers instanceof Headers ? init.headers.get('range') : null;
    calls.push({ url: String(url), range });
    return Promise.resolve(script[Math.min(calls.length - 1, script.length - 1)].make());
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

function freshManager(overrides: Partial<ConstructorParameters<typeof ModelManager>[0]> = {}) {
  const { manifest, bytes, chunks } = makeFakeManifest();
  const storage = new FakeCacheStorage();
  const manager = new ModelManager({
    manifest,
    cacheStorage: storage as unknown as CacheStorage,
    probe: PROBE_OK,
    ...overrides,
  });
  return { manager, manifest, bytes, chunks, storage };
}

describe('ModelManager — download, verify, cache, fallback (S3)', () => {
  beforeEach(() => {
    expect(globalThis.caches).toBeUndefined(); // node env: nothing global leaks in
  });

  it('downloads the pinned file with streaming progress and ends ready (A12)', async () => {
    const fetcher = fakeFetch([{ make: () => chunked(makeFakeManifest().chunks) }]);
    const { manager, manifest, bytes, chunks, storage } = freshManager({
      fetchImpl: fetcher.impl as typeof fetch,
    });
    void chunks;

    const seen: ModelProgress[] = [];
    manager.subscribe((p) => seen.push({ ...p }));
    await manager.download();

    expect(manager.getStatus().state).toBe('ready');
    expect(manager.getStatus().receivedBytes).toBe(bytes.length);
    expect(fetcher.calls.map((c) => c.url)).toEqual([manifest.url]);
    // progress streamed monotonically through 'downloading' → 'verifying' → 'ready'
    const downloading = seen.filter((p) => p.state === 'downloading');
    expect(downloading.length, 'chunk-level progress updates').toBeGreaterThan(1);
    const received = downloading.map((p) => p.receivedBytes);
    expect([...received].sort((a, b) => a - b)).toEqual(received);
    expect(new Set(seen.map((p) => p.state))).toEqual(new Set(['downloading', 'verifying', 'ready']));
    // verified BEFORE cached: the single put carries the exact pinned bytes
    const cache = storage.caches.get(MODEL_CACHE_NAME)!;
    expect(cache.puts).toHaveLength(1);
    expect(cache.puts[0]!.url).toBe(manifest.url);
    expect(Buffer.compare(Buffer.from(cache.puts[0]!.bytes), Buffer.from(bytes))).toBe(0);
  });

  it('a checksum mismatch purges the cache and ends failed (A13)', async () => {
    const model = makeFakeManifest();
    const bad = u8(model.bytes);
    bad[123] ^= 0xff;
    const fetcher = fakeFetch([{ make: () => chunked([bad]) }]);
    const { manager, manifest, storage } = freshManager({ fetchImpl: fetcher.impl as typeof fetch });

    await manager.download();

    const status = manager.getStatus();
    expect(status.state).toBe('failed');
    expect(status.reason).toBe('checksum-mismatch');
    // the bad file must be purged: nothing cached, cache deleted
    expect(storage.deletedNames).toContain(MODEL_CACHE_NAME);
    expect((await storage.caches.get(MODEL_CACHE_NAME)?.match(manifest.url)) ?? null).toBeNull();
    expect(storage.caches.get(MODEL_CACHE_NAME)?.puts ?? []).toHaveLength(0);
  });

  it('a truncated file (stream ends short of the pinned size) fails closed with a purge (A13)', async () => {
    const model = makeFakeManifest();
    const fetcher = fakeFetch([
      { make: () => chunked([model.bytes.subarray(0, model.bytes.length - 500)]) },
    ]);
    const { manager, storage } = freshManager({ fetchImpl: fetcher.impl as typeof fetch });

    await manager.download();

    expect(manager.getStatus().state).toBe('failed');
    expect(manager.getStatus().reason).toBe('size-mismatch');
    expect(storage.deletedNames).toContain(MODEL_CACHE_NAME);
    expect(storage.caches.get(MODEL_CACHE_NAME)?.puts ?? []).toHaveLength(0);
  });

  it('an HTTP error (404) fails closed without caching (A13)', async () => {
    const fetcher = fakeFetch([{ make: () => new Response('nope', { status: 404 }) }]);
    const { manager, storage } = freshManager({ fetchImpl: fetcher.impl as typeof fetch });

    await manager.download();

    expect(manager.getStatus().state).toBe('failed');
    expect(manager.getStatus().reason).toBe('http-error');
    expect(storage.deletedNames).toContain(MODEL_CACHE_NAME);
  });

  it('an interrupted download RESUMES with a Range request and ends ready (A12)', async () => {
    const model = makeFakeManifest();
    const first = [model.bytes.subarray(0, 1000), model.bytes.subarray(1000, 2000)]; // then killed
    const fetcher = fakeFetch([
      { make: () => killingStream(first) },
      { make: () => chunked([model.bytes.subarray(2000)], { status: 206 }) },
    ]);
    const { manager, bytes, storage } = freshManager({ fetchImpl: fetcher.impl as typeof fetch });

    await manager.download();

    expect(manager.getStatus().state).toBe('ready');
    expect(fetcher.calls).toHaveLength(2);
    expect(fetcher.calls[0]!.range).toBeNull();
    expect(fetcher.calls[1]!.range).toBe(`bytes=${2000}-`); // resumed from 2000, not from zero
    const cache = storage.caches.get(MODEL_CACHE_NAME)!;
    expect(Buffer.compare(Buffer.from(cache.puts[0]!.bytes), Buffer.from(bytes))).toBe(0);
  });

  it('a server that ignores Range makes the app restart cleanly from zero (A12)', async () => {
    const model = makeFakeManifest();
    const fetcher = fakeFetch([
      { make: () => killingStream([model.bytes.subarray(0, 1000)]) },
      { make: () => chunked([model.bytes], { status: 200 }) }, // full 200, no 206
    ]);
    const { manager, bytes, storage } = freshManager({ fetchImpl: fetcher.impl as typeof fetch });

    await manager.download();

    expect(manager.getStatus().state).toBe('ready');
    const cache = storage.caches.get(MODEL_CACHE_NAME)!;
    expect(Buffer.compare(Buffer.from(cache.puts[0]!.bytes), Buffer.from(bytes))).toBe(0);
    expect(manager.getStatus().receivedBytes).toBe(bytes.length);
  });

  it('gives up after the attempt budget and fails closed with a purge (A12/A13)', async () => {
    const fetcher = fakeFetch([{ make: () => killingStream([u8(randomBytes(10))]) }]);
    const { manager, storage } = freshManager({ fetchImpl: fetcher.impl as typeof fetch });

    await manager.download();

    expect(manager.getStatus().state).toBe('failed');
    expect(manager.getStatus().reason).toBe('network-error');
    expect(fetcher.calls).toHaveLength(3); // maxAttempts = 3
    expect(storage.deletedNames).toContain(MODEL_CACHE_NAME);
  });

  it('a cached model is ready without any network (A14)', async () => {
    const model = makeFakeManifest();
    const fetcher = fakeFetch([{ make: () => chunked(model.chunks) }]);
    const { manager, manifest, bytes, storage } = freshManager({
      fetchImpl: fetcher.impl as typeof fetch,
    });
    const cache = await storage.open(MODEL_CACHE_NAME);
    await cache.put(manifest.url, new Response(new Blob([bytes])));

    await manager.check();
    expect(manager.getStatus().state).toBe('ready');
    await manager.download(); // a download request short-circuits on the cache
    expect(fetcher.calls).toHaveLength(0);
  });

  it('a stale cached entry with the wrong size is re-downloaded and replaced', async () => {
    const model = makeFakeManifest();
    const fetcher = fakeFetch([{ make: () => chunked(model.chunks) }]);
    const { manager, manifest, bytes, storage } = freshManager({
      fetchImpl: fetcher.impl as typeof fetch,
    });
    const cache = await storage.open(MODEL_CACHE_NAME);
    await cache.put(manifest.url, new Response(new Blob([u8(randomBytes(500))]))); // stale garbage

    await manager.download();

    expect(manager.getStatus().state).toBe('ready');
    const cacheAfter = storage.caches.get(MODEL_CACHE_NAME)!;
    expect(
      Buffer.compare(Buffer.from(cacheAfter.entries.get(manifest.url)!), Buffer.from(bytes)),
    ).toBe(0);
  });

  it('an unsupported browser ends unsupported without any fetch (A13)', async () => {
    const fetcher = fakeFetch([{ make: () => chunked([u8(randomBytes(1))]) }]);
    const { manager, storage } = freshManager({
      probe: PROBE_NO,
      fetchImpl: fetcher.impl as typeof fetch,
    });

    await manager.check();
    expect(manager.getStatus().state).toBe('unsupported');

    await manager.download();
    expect(manager.getStatus().state).toBe('unsupported');
    expect(fetcher.calls).toHaveLength(0);
    expect(storage.caches.size).toBe(0);
  });

  it('check() with no cache and a supported browser stays absent (no network)', async () => {
    const fetcher = fakeFetch([{ make: () => chunked([u8(randomBytes(1))]) }]);
    const { manager } = freshManager({ fetchImpl: fetcher.impl as typeof fetch });

    await manager.check();
    expect(manager.getStatus().state).toBe('absent');
    expect(fetcher.calls).toHaveLength(0);
  });

  it('readCached() returns the cached bytes (the S4 runtime entry point)', async () => {
    const model = makeFakeManifest();
    const fetcher = fakeFetch([{ make: () => chunked(model.chunks) }]);
    const { manager, bytes } = freshManager({ fetchImpl: fetcher.impl as typeof fetch });

    expect(await manager.readCached()).toBeNull();
    await manager.download();
    const cached = await manager.readCached();
    expect(cached).not.toBeNull();
    expect(Buffer.compare(Buffer.from(cached!), Buffer.from(bytes))).toBe(0);
  });

  it('concurrent download() calls are single-flight (one download, one put)', async () => {
    const model = makeFakeManifest();
    const fetcher = fakeFetch([{ make: () => chunked(model.chunks) }]);
    const { manager, storage } = freshManager({ fetchImpl: fetcher.impl as typeof fetch });

    await Promise.all([manager.download(), manager.download(), manager.download()]);

    expect(fetcher.calls).toHaveLength(1);
    expect(storage.caches.get(MODEL_CACHE_NAME)!.puts).toHaveLength(1);
    expect(manager.getStatus().state).toBe('ready');
  });

  it('a failed download can be retried back to ready (the Try again path)', async () => {
    const model = makeFakeManifest();
    const fetcher = fakeFetch([
      { make: () => new Response('boom', { status: 500 }) },
      { make: () => chunked(model.chunks) },
    ]);
    const { manager, storage } = freshManager({ fetchImpl: fetcher.impl as typeof fetch });

    await manager.download();
    expect(manager.getStatus().state).toBe('failed');
    await manager.download(); // retry
    expect(manager.getStatus().state).toBe('ready');
    expect(storage.caches.get(MODEL_CACHE_NAME)!.puts).toHaveLength(1);
  });
});
