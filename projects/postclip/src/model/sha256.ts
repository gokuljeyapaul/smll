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

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const HEX = '0123456789abcdef';

export class Sha256Incremental {
  private h = new Uint32Array(8);
  /** Bytes of the current partial block (length < 64). */
  private pending = new Uint8Array(64);
  private pendingLen = 0;
  /** Total message length in bytes (for the final padding). */
  private totalLen = 0;
  private w = new Uint32Array(64);

  constructor() {
    this.reset();
  }

  reset(): void {
    this.h[0] = 0x6a09e667;
    this.h[1] = 0xbb67ae85;
    this.h[2] = 0x3c6ef372;
    this.h[3] = 0xa54ff53a;
    this.h[4] = 0x510e527f;
    this.h[5] = 0x9b05688c;
    this.h[6] = 0x1f83d9ab;
    this.h[7] = 0x5be0cd19;
    this.pendingLen = 0;
    this.totalLen = 0;
  }

  update(chunk: Uint8Array): void {
    if (chunk.length === 0) return;
    this.totalLen += chunk.length;
    let at = 0;
    if (this.pendingLen > 0) {
      const take = Math.min(chunk.length, 64 - this.pendingLen);
      this.pending.set(chunk.subarray(0, take), this.pendingLen);
      this.pendingLen += take;
      at = take;
      if (this.pendingLen === 64) {
        this.compress(this.pending);
        this.pendingLen = 0;
      }
    }
    while (at + 64 <= chunk.length) {
      this.compress(chunk.subarray(at, at + 64));
      at += 64;
    }
    if (at < chunk.length) {
      this.pending.set(chunk.subarray(at), 0);
      this.pendingLen = chunk.length - at;
    }
  }

  private compress(block: Uint8Array): void {
    const w = this.w;
    const dv = new DataView(block.buffer, block.byteOffset, block.byteLength);
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = ((w[i - 15] >>> 7) | (w[i - 15] << 25)) ^ ((w[i - 15] >>> 18) | (w[i - 15] << 14)) ^ (w[i - 15] >>> 3);
      const s1 = ((w[i - 2] >>> 17) | (w[i - 2] << 15)) ^ ((w[i - 2] >>> 19) | (w[i - 2] << 13)) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = this.h;
    for (let i = 0; i < 64; i++) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + K[i] + w[i]) >>> 0;
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }
    this.h[0] = (this.h[0] + a) >>> 0;
    this.h[1] = (this.h[1] + b) >>> 0;
    this.h[2] = (this.h[2] + c) >>> 0;
    this.h[3] = (this.h[3] + d) >>> 0;
    this.h[4] = (this.h[4] + e) >>> 0;
    this.h[5] = (this.h[5] + f) >>> 0;
    this.h[6] = (this.h[6] + g) >>> 0;
    this.h[7] = (this.h[7] + h) >>> 0;
  }

  /** Finalize and return the lowercase hex digest. Stable across calls
   *  (the padding compression runs on a copy of the running state). */
  digestHex(): string {
    const hSave = Uint32Array.from(this.h);
    try {
      return this.digestHexInternal();
    } finally {
      this.h = hSave;
    }
  }

  private digestHexInternal(): string {
    // Padding: 0x80, zeros, then the 64-bit big-endian bit length, ending on
    // a 64-byte block boundary (one block if < 56 bytes are pending, two
    // otherwise — the 8 length bytes must fit in the LAST block).
    const total = this.pendingLen < 56 ? 64 : 128;
    const pad = new Uint8Array(total);
    pad.set(this.pending.subarray(0, this.pendingLen));
    pad[this.pendingLen] = 0x80;
    const bitLenHi = Math.floor(this.totalLen / 0x20000000); // totalLen * 8 >>> 32
    const bitLenLo = (this.totalLen << 3) >>> 0;
    const dv = new DataView(pad.buffer);
    dv.setUint32(total - 8, bitLenHi);
    dv.setUint32(total - 4, bitLenLo);
    for (let at = 0; at < total; at += 64) {
      this.compress(pad.subarray(at, at + 64));
    }

    let out = '';
    for (let i = 0; i < 8; i++) {
      const v = this.h[i];
      out += HEX[(v >>> 28) & 0xf] + HEX[(v >>> 24) & 0xf] + HEX[(v >>> 20) & 0xf] + HEX[(v >>> 16) & 0xf];
      out += HEX[(v >>> 12) & 0xf] + HEX[(v >>> 8) & 0xf] + HEX[(v >>> 4) & 0xf] + HEX[v & 0xf];
    }
    return out;
  }
}
