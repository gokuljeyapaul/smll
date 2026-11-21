/**
 * Fetch the OCR engine's runtime assets into dist/ocr-assets/ (build output —
 * nothing here is committed; the engine serves everything same-origin):
 *   - tesseract.js worker + WASM core, copied from node_modules (pinned by the
 *     lockfile), so no third-party CDN is used at runtime;
 *   - the English traineddata, downloaded from a pinned URL and verified
 *     against a pinned sha256 (fail closed on mismatch).
 *
 * Run as part of `npm run build` (after vite build). Network is required;
 * CI's ubuntu runner has it.
 */
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DIST_ASSETS = join(HERE, '..', 'dist', 'ocr-assets');

// Pinned language data (tessdata 4.0.0_fast, English). The bench in
// docs/evidence/S0/ocr_engine_comparison.md records why fast over best.
const LANG = {
  url: 'https://tessdata.projectnaptha.com/4.0.0_fast/eng.traineddata.gz',
  sha256: '18c1ac52b75e35d44735fb6c2a60acfaf23033524653200738e98f0243edb75b',
  sizeBytes: 1984273,
};

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

async function main() {
  mkdirSync(DIST_ASSETS, { recursive: true });

  // 1. Worker + core from the locked node_modules (same-origin, no CDN).
  const nodeModules = join(HERE, '..', 'node_modules');
  copyFileSync(
    join(nodeModules, 'tesseract.js', 'dist', 'worker.min.js'),
    join(DIST_ASSETS, 'worker.min.js'),
  );
  const coreDir = join(nodeModules, 'tesseract.js-core');
  let coreBytes = 0;
  for (const f of readdirSync(coreDir)) {
    if (/^tesseract-core-.*(\.wasm\.js|\.wasm)$|^LICENSE$/.test(f)) {
      copyFileSync(join(coreDir, f), join(DIST_ASSETS, f));
      coreBytes += statSync(join(DIST_ASSETS, f)).size;
    }
  }
  console.log(`ocr-assets: worker + core copied (${coreBytes} bytes)`);

  // 2. Language data, pinned and verified.
  const langPath = join(DIST_ASSETS, 'eng.traineddata.gz');
  let needDownload = true;
  try {
    if (statSync(langPath).size === LANG.sizeBytes && sha256(langPath) === LANG.sha256) {
      needDownload = false;
    }
  } catch {
    needDownload = true;
  }
  if (needDownload) {
    const res = await fetch(LANG.url);
    if (!res.ok) throw new Error(`eng.traineddata.gz download failed: HTTP ${res.status}`);
    const bytes = Buffer.from(await res.arrayBuffer());
    writeFileSync(langPath, bytes);
  }
  const gotSha = sha256(langPath);
  const gotSize = statSync(langPath).size;
  if (gotSha !== LANG.sha256 || gotSize !== LANG.sizeBytes) {
    throw new Error(
      `eng.traineddata.gz verification failed: sha256 ${gotSha} (expected ${LANG.sha256}), size ${gotSize}`,
    );
  }
  console.log(`ocr-assets: eng.traineddata.gz verified (sha256 ${gotSha.slice(0, 16)}…, ${gotSize} bytes)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
