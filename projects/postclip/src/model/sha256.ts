/**
 * Incremental (streamed) SHA-256 (S3 — A12/A13: the model file is hashed
 * WHILE it downloads, so the digest is ready the moment the last byte
 * arrives and the file is verified BEFORE it enters the cache).
 *
 * Pure TS with no dependency on crypto.subtle (which only digests complete
 * buffers — useless for a resumable download): the differential unit tests
 * prove it against node:crypto on boundary sizes, and the e2e flows prove
 * it against the real pinned file's recorded sha256.
 */

export class Sha256Incremental {
  /** RED scaffold: no hashing behavior yet. */
  update(chunk: Uint8Array): void {
    void chunk;
  }

  /** RED scaffold: no hashing behavior yet — always the all-zero digest. */
  digestHex(): string {
    return '0'.repeat(64);
  }

  /** RED scaffold: no reset behavior yet. */
  reset(): void {
    // no behavior yet
  }
}
