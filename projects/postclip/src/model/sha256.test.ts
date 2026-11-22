// @vitest-environment node
/**
 * Streaming SHA-256 unit tests (S3 — A12/A13): the incremental
 * implementation must agree with node:crypto on the canonical vectors, on
 * every block-length boundary, on multi-update splits, and after reset.
 * Differential against node:crypto (the reference), never copy-pasted
 * constants alone: the canonical vectors anchor the algorithm, the random
 * differential anchors it on real data.
 */
import { createHash, randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { Sha256Incremental } from './sha256';

const nodeSha = (bytes: Uint8Array): string =>
  createHash('sha256').update(bytes).digest('hex');

describe('Sha256Incremental — streaming sha256 (S3)', () => {
  it('digests the canonical vectors (empty, "abc", fox)', () => {
    const fox = new TextEncoder().encode('The quick brown fox jumps over the lazy dog');
    const empty = new Sha256Incremental();
    expect(empty.digestHex()).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
    const abc = new Sha256Incremental();
    abc.update(new TextEncoder().encode('abc'));
    expect(abc.digestHex()).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
    const foxHash = new Sha256Incremental();
    foxHash.update(fox);
    expect(foxHash.digestHex()).toBe(nodeSha(fox));
  });

  it('agrees with node:crypto on every block-length boundary', () => {
    // Padding boundaries around the 64-byte block and the 8-byte length tail.
    for (const len of [1, 55, 56, 63, 64, 65, 119, 120, 127, 128, 129, 1000]) {
      const bytes = randomBytes(len);
      const h = new Sha256Incremental();
      h.update(bytes);
      expect(h.digestHex(), `length ${len}`).toBe(nodeSha(bytes));
    }
  });

  it('agrees with node:crypto across multi-update splits (including empty updates)', () => {
    for (const trial of [0, 1, 2, 3]) {
      const bytes = randomBytes(5000 + trial * 7919);
      const h = new Sha256Incremental();
      let at = 0;
      while (at < bytes.length) {
        const take = 1 + Math.floor(Math.random() * 200);
        h.update(bytes.subarray(at, Math.min(at + take, bytes.length)));
        at += take;
      }
      h.update(new Uint8Array(0)); // empty update must be a no-op
      expect(h.digestHex(), `trial ${trial}`).toBe(nodeSha(bytes));
    }
  });

  it('reset() starts a fresh digest over new data', () => {
    const a = randomBytes(1000);
    const b = randomBytes(2000);
    const h = new Sha256Incremental();
    h.update(a);
    h.reset();
    h.update(b);
    expect(h.digestHex()).toBe(nodeSha(b));
    expect(h.digestHex()).toBe(nodeSha(b)); // digest() is stable (no reset side effect)
  });

  it('hashes a ~1 MiB random buffer byte-for-byte like node:crypto', () => {
    const bytes = randomBytes(1048576);
    const h = new Sha256Incremental();
    h.update(bytes);
    expect(h.digestHex()).toBe(nodeSha(bytes));
  });
});
