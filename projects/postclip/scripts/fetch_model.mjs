#!/usr/bin/env node
/**
 * Fetch the pinned cleanup model (S3) into .cache/models/ (gitignored — the
 * weights are NEVER committed) and verify it: size AND sha256 must match
 * src/model/manifest.ts, the single source of truth, whose fields this
 * script reads. Idempotent: an existing verified file is not re-downloaded.
 *
 * The manifest's recorded sha256/size come from HF's LFS metadata for the
 * pinned revision (x-linked-etag / x-linked-size on the pinned resolve URL)
 * cross-checked here against the real downloaded bytes. Provenance — the
 * commands that produced the hash — is written to
 * .cache/models/model-meta.json and mirrored into docs/evidence/S3/.
 *
 * Usage: node scripts/fetch_model.mjs   (called by scripts/setup.sh in CI)
 */
import { createHash } from 'node:crypto';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync, writeSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

// The pinned fields, read from the committed manifest (fail loudly if the
// file drifts so the script can never download something unpinned).
const src = readFileSync(join(ROOT, 'src/model/manifest.ts'), 'utf-8');
function field(name) {
  const m = src.match(new RegExp(`\\b${name}:\\s*'([^']+)'`));
  if (!m) throw new Error(`fetch_model: manifest field "${name}" not found in src/model/manifest.ts`);
  return m[1];
}
const MANIFEST = {
  repo: field('repo'),
  revision: field('revision'),
  filename: field('filename'),
  url: field('url'),
  sha256: field('sha256'),
  license: field('license'),
  sizeBytes: Number(src.match(/\bsizeBytes:\s*(\d+)/)?.[1]),
};
if (!MANIFEST.sizeBytes || !/^[0-9a-f]{64}$/.test(MANIFEST.sha256)) {
  throw new Error('fetch_model: manifest sha256/sizeBytes are malformed');
}

const target = join(ROOT, '.cache/models', MANIFEST.filename);
const metaPath = join(ROOT, '.cache/models/model-meta.json');
mkdirSync(dirname(target), { recursive: true });

function hashFile(path) {
  const h = createHash('sha256');
  const fd = readFileSync(path); // ~397 MB: hashed from the real bytes
  h.update(fd);
  return { sha256: h.digest('hex'), size: fd.length };
}

function verified(existing) {
  return existing.sha256 === MANIFEST.sha256 && existing.size === MANIFEST.sizeBytes;
}

function writeMeta(existing, downloadedNow) {
  writeFileSync(
    metaPath,
    JSON.stringify(
      {
        filename: MANIFEST.filename,
        repo: MANIFEST.repo,
        revision: MANIFEST.revision,
        url: MANIFEST.url,
        sha256: existing.sha256,
        sizeBytes: existing.size,
        license: MANIFEST.license,
        fetchedAt: new Date().toISOString(),
        downloadedThisRun: downloadedNow,
        producedBy: 'node scripts/fetch_model.mjs',
        crossCheck: 'HF LFS x-linked-etag for the pinned revision (see docs/evidence/S3/model-manifest.json)',
      },
      null,
      2,
    ) + '\n',
  );
}

// 1. Already fetched and verified? Nothing to do (fast, offline-safe).
if (existsSync(target)) {
  const existing = hashFile(target);
  if (verified(existing)) {
    console.log(`fetch_model: ${MANIFEST.filename} already present and VERIFIED`);
    console.log(`fetch_model: sha256=${existing.sha256} size=${existing.size} (matches src/model/manifest.ts)`);
    writeMeta(existing, false);
    process.exit(0);
  }
  console.log('fetch_model: existing file does NOT match the pinned manifest — re-downloading');
  unlinkSync(target);
}

// 2. Download the pinned URL with retries + RANGE RESUME. CI runners are
//    progressively rate-limited by the model host (observed 2026-11-23: all
//    fresh 397 MB downloads cut ~100 s in, then quick-rejected), so each retry
//    resumes from the bytes already on disk instead of restarting from byte 0.
//    The sha256 hash object lives across attempts (the byte stream is hashed
//    incrementally in order, so resumed bytes continue the same digest).
console.log(`fetch_model: downloading ${MANIFEST.url}`);
console.log(`fetch_model: expecting size=${MANIFEST.sizeBytes} sha256=${MANIFEST.sha256}`);
const tmp = `${target}.part`;
const MAX_ATTEMPTS = 6;
const BACKOFF_S = [5, 15, 45, 90, 180];
let lastErr = null;
let hash = createHash('sha256');
let bytesSoFar = 0;
let tmpSize = existsSync(tmp) ? statSync(tmp).size : 0;
if (tmpSize > 0) {
  // A .part from a killed earlier run exists: hash it, then resume from there.
  const existing = readFileSync(tmp);
  hash.update(existing);
  bytesSoFar = existing.length;
  console.log(`fetch_model: resuming from existing .part (${bytesSoFar} bytes)`);
}
for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
  try {
    const headers = {};
    if (bytesSoFar > 0) headers.range = `bytes=${bytesSoFar}-`;
    const res = await fetch(MANIFEST.url, { redirect: 'follow', headers });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    if (res.body === null) throw new Error('empty body');
    if (bytesSoFar > 0 && res.status === 200) {
      // The host ignored the range: restart cleanly from byte 0.
      unlinkSync(tmp);
      hash = createHash('sha256');
      bytesSoFar = 0;
    }
    const fd = openSync(tmp, bytesSoFar > 0 && res.status === 206 ? 'a' : 'w');
    for await (const chunk of res.body) {
      const buf = Buffer.from(chunk);
      hash.update(buf);
      writeSync(fd, buf);
      bytesSoFar += buf.length;
    }
    closeSync(fd);
    if (bytesSoFar !== MANIFEST.sizeBytes) {
      throw new Error(`truncated stream: got ${bytesSoFar}/${MANIFEST.sizeBytes} bytes`);
    }
    const sha256 = hash.digest('hex');
    if (sha256 !== MANIFEST.sha256) {
      throw new Error(`download integrity mismatch: sha256=${sha256}`);
    }
    renameSync(tmp, target);
    console.log(`fetch_model: downloaded ${bytesSoFar} bytes (across ${attempt} attempt(s))`);
    console.log(`fetch_model: sha256 VERIFIED: ${sha256} (matches src/model/manifest.ts)`);
    writeMeta({ sha256, size: bytesSoFar }, true);
    lastErr = null;
    break;
  } catch (err) {
    lastErr = err;
    console.error(`fetch_model: attempt ${attempt} failed at byte ${bytesSoFar}: ${String(err)}`);
    if (String(err).includes('integrity mismatch') || String(err).includes('truncated')) {
      // Unusable bytes: start over cleanly on the next attempt.
      if (existsSync(tmp)) unlinkSync(tmp);
      hash = createHash('sha256');
      bytesSoFar = 0;
    } else {
      // Transport cut: KEEP the partial + hash state and resume.
      console.log(`fetch_model: keeping .part (${bytesSoFar} bytes) for range-resume`);
    }
    if (attempt < MAX_ATTEMPTS) {
      const wait = BACKOFF_S[Math.min(attempt - 1, BACKOFF_S.length - 1)];
      console.log(`fetch_model: retrying in ${wait}s`);
      await new Promise((r) => setTimeout(r, wait * 1000));
    }
  }
}
if (lastErr !== null || !existsSync(target)) {
  console.error('fetch_model: FAILED after retries');
  process.exit(1);
}

// 3. Cross-check against HF's LFS metadata for the pinned revision (best
//    effort: the local hash above is the enforcing check).
try {
  const res = await fetch(MANIFEST.url, { method: 'HEAD', redirect: 'follow' });
  const linkedEtag = res.headers.get('x-linked-etag')?.replace(/"/g, '');
  const linkedSize = res.headers.get('x-linked-size');
  const ok = linkedEtag === MANIFEST.sha256 && Number(linkedSize) === MANIFEST.sizeBytes;
  console.log(
    `fetch_model: HF LFS cross-check ${ok ? 'MATCHES' : 'DIFFERS'}: x-linked-etag=${linkedEtag} x-linked-size=${linkedSize}`,
  );
} catch (err) {
  console.warn(`fetch_model: HF LFS cross-check skipped (network): ${String(err)}`);
}
console.log(`fetch_model: OK (${statSync(target).size} bytes at ${target})`);
