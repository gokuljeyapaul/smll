/**
 * The model cache store (S3): the ONE persistence the plan allows besides
 * the app-shell cache ("Cache Storage or OPFS"). Two backends behind one
 * interface, selected by a real capability probe at runtime — because both
 * engines have a measured quirk at the pinned model's size (396,705,472
 * bytes; see docs/evidence/S3/model-manifest.json):
 *
 *  - headless Chromium's Cache Storage put() throws "Unexpected internal
 *    error" for a ~397 MiB body (measured), while its OPFS handles the same
 *    file perfectly with constant memory via streaming temp-file writes;
 *  - Playwright's WebKit build has a broken async OPFS writable ("unknown
 *    transient reason" even for 4 KiB — measured), while its Cache Storage
 *    stores the full body fine (measured: 396,705,472 bytes in ~8 s).
 *
 * The interface keeps the privacy rule mechanical in BOTH backends: bytes
 * only ever reach the cache KEY after size+sha256 verification
 * (appendTemp → verify → promoteTemp), and any failure path drops the temp
 * and clears the cache (A13 "the bad file purged").
 */

import { MODEL_CACHE_NAME } from './manifest';

export interface ModelStore {
  /** 'opfs' | 'cache-storage' — which backend this session uses. */
  readonly kind: 'opfs' | 'cache-storage';
  /** Append a chunk to the in-progress temp (opened on first call). */
  appendTemp(chunk: Uint8Array): Promise<void>;
  /** Drop the temp and any staged bytes. */
  discardTemp(): Promise<void>;
  /** Promote the verified temp to the cache key (the only path to a hit). */
  promoteTemp(key: string): Promise<void>;
  /** Size of the cached entry under `key`, or null when absent. */
  size(key: string): Promise<number | null>;
  /** Read the cached bytes under `key` (S4 runtime entry point). */
  read(key: string): Promise<Uint8Array | null>;
  /** R2-3 (A37): write a SMALL text record under `key` (the verified
   * sha256 marker). Metadata only — never model bytes, never user text. */
  putText(key: string, text: string): Promise<void>;
  /** R2-3 (A37): read a small text record, or null when absent. */
  readText(key: string): Promise<string | null>;
  /** Remove the model cache entirely (purge). */
  clear(): Promise<void>;
}

const OPFS_DIR = 'postclip-model';
const OPFS_TEMP = '.partial-download';

/** Cheap, real OPFS probe: write+read+remove 4 KiB (broken OPFS fails at any size). */
async function probeOpfs(): Promise<boolean> {
  try {
    const root = await navigator.storage.getDirectory();
    const dir = await root.getDirectoryHandle(OPFS_DIR, { create: true });
    const fh = await dir.getFileHandle('.probe', { create: true });
    const w = await fh.createWritable();
    await w.write(new Uint8Array(4096).fill(1));
    await w.close();
    const file = await fh.getFile();
    const ok = file.size === 4096;
    await dir.removeEntry('.probe');
    return ok;
  } catch {
    return false;
  }
}

/** Is ANY model-cache backend available (OPFS or Cache Storage)? */
export async function modelStoreAvailable(): Promise<boolean> {
  if (await probeOpfs()) return true;
  return typeof globalThis.caches !== 'undefined' && typeof globalThis.caches?.open === 'function';
}

/** Open the best available backend, or null when neither works. */
export async function openModelStore(): Promise<ModelStore | null> {
  if (await probeOpfs()) {
    try {
      return new OpfsModelStore();
    } catch {
      // fall through to Cache Storage
    }
  }
  if (typeof globalThis.caches !== 'undefined' && typeof globalThis.caches?.open === 'function') {
    return new CacheStorageModelStore(MODEL_CACHE_NAME);
  }
  return null;
}

/** OPFS backend: streams chunks to a temp file (constant memory), promotes
 *  after verification by natively streaming temp → final handle. */
export class OpfsModelStore implements ModelStore {
  readonly kind = 'opfs' as const;
  private writable: FileSystemWritableFileStream | null = null;

  private async dir(): Promise<FileSystemDirectoryHandle> {
    const root = await navigator.storage.getDirectory();
    return root.getDirectoryHandle(OPFS_DIR, { create: true });
  }

  private async tempHandle(): Promise<FileSystemFileHandle> {
    return (await this.dir()).getFileHandle(OPFS_TEMP, { create: true });
  }

  async appendTemp(chunk: Uint8Array): Promise<void> {
    this.writable ??= await (await this.tempHandle()).createWritable();
    await this.writable.write(chunk as Uint8Array<ArrayBuffer>);
  }

  async discardTemp(): Promise<void> {
    try {
      await this.writable?.close();
    } catch {
      // already closed or broken — the remove below is the real cleanup
    }
    this.writable = null;
    try {
      await (await this.dir()).removeEntry(OPFS_TEMP);
    } catch {
      // no temp existed
    }
  }

  async promoteTemp(key: string): Promise<void> {
    const dir = await this.dir();
    const temp = await this.tempHandle();
    try {
      await this.writable?.close();
    } catch {
      // temp was closed after the last append in a prior session
    }
    this.writable = null;
    const tempFile = await temp.getFile();
    const dest = await dir.getFileHandle(key, { create: true });
    const w = await dest.createWritable();
    await w.write(tempFile); // native streaming, no JS-buffer copy
    await w.close();
    await dir.removeEntry(OPFS_TEMP);
  }

  async size(key: string): Promise<number | null> {
    try {
      const file = await (await (await this.dir()).getFileHandle(key)).getFile();
      return file.size;
    } catch {
      return null;
    }
  }

  async read(key: string): Promise<Uint8Array | null> {
    try {
      const file = await (await (await this.dir()).getFileHandle(key)).getFile();
      if (file.size === 0) return null;
      return new Uint8Array(await file.arrayBuffer());
    } catch {
      return null;
    }
  }

  async putText(key: string, text: string): Promise<void> {
    const fh = await (await this.dir()).getFileHandle(key, { create: true });
    const w = await fh.createWritable();
    await w.write(new TextEncoder().encode(text) as Uint8Array<ArrayBuffer>);
    await w.close();
  }

  async readText(key: string): Promise<string | null> {
    try {
      const file = await (await (await this.dir()).getFileHandle(key)).getFile();
      if (file.size === 0) return null;
      return await file.text();
    } catch {
      return null;
    }
  }

  async clear(): Promise<void> {
    try {
      await this.writable?.close();
    } catch {
      // ignore
    }
    this.writable = null;
    try {
      const root = await navigator.storage.getDirectory();
      await root.removeEntry(OPFS_DIR, { recursive: true });
    } catch {
      // nothing to purge
    }
  }
}

/** Cache Storage backend (the plan's other sanctioned persistence): the temp
 *  is the staged chunk list in memory; promote is a single put AFTER
 *  verification (WebKit measured storing the full 396,705,472-byte body). */
export class CacheStorageModelStore implements ModelStore {
  readonly kind = 'cache-storage' as const;
  constructor(
    private readonly cacheName: string,
    private readonly cacheStorage: CacheStorage = globalThis.caches,
  ) {}

  private temp: Uint8Array[] = [];
  private tempBytes = 0;

  private async cache(): Promise<Cache> {
    return this.cacheStorage.open(this.cacheName);
  }

  async appendTemp(chunk: Uint8Array): Promise<void> {
    this.temp.push(chunk);
    this.tempBytes += chunk.length;
  }

  async discardTemp(): Promise<void> {
    this.temp = [];
    this.tempBytes = 0;
  }

  async promoteTemp(key: string): Promise<void> {
    const cache = await this.cache();
    await cache.put(key, new Response(new Blob(this.temp as BlobPart[])));
    this.temp = [];
    this.tempBytes = 0;
  }

  async size(key: string): Promise<number | null> {
    try {
      const res = await (await this.cache()).match(key);
      if (!res) return null;
      const blob = await res.blob();
      return blob.size;
    } catch {
      return null;
    }
  }

  async read(key: string): Promise<Uint8Array | null> {
    try {
      const res = await (await this.cache()).match(key);
      if (!res) return null;
      return new Uint8Array(await res.arrayBuffer());
    } catch {
      return null;
    }
  }

  async putText(key: string, text: string): Promise<void> {
    const cache = await this.cache();
    await cache.put(key, new Response(text, { headers: { 'content-type': 'application/json' } }));
  }

  async readText(key: string): Promise<string | null> {
    try {
      const res = await (await this.cache()).match(key);
      if (!res) return null;
      return await res.text();
    } catch {
      return null;
    }
  }

  async clear(): Promise<void> {
    this.temp = [];
    this.tempBytes = 0;
    try {
      await this.cacheStorage.delete(this.cacheName);
    } catch {
      // nothing to purge
    }
  }
}
