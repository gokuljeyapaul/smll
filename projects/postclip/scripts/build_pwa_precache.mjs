/**
 * Generate dist/precache-manifest.js for the service worker (public/sw.js
 * importScripts it): every file of the finished build with a sha256 revision,
 * run AFTER vite build and scripts/fetch_ocr_assets.mjs so the list always
 * covers the real dist/ — including /ocr-assets/, so the offline app shell
 * also carries the OCR runtime (first load → full offline processing).
 *
 * Each entry gets a revision query (?__pcv=<sha256 prefix>) as its cache key
 * so fixed-name files (index.html, ocr-assets/*, icons) are re-cached on
 * every deploy; content-hashed vite assets keep their own hashed URLs.
 *
 * The service worker file itself and this manifest are NOT precached (a
 * worker must not serve its own update).
 *
 * Usage: node scripts/build_pwa_precache.mjs   (part of `npm run build`)
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DIST = join(HERE, '..', 'dist');
const SKIP = new Set(['sw.js', 'precache-manifest.js']);

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

const files = walk(DIST).sort();
const entries = [];
let totalBytes = 0;
for (const file of files) {
  const rel = relative(DIST, file).split(sep).join('/');
  if (SKIP.has(rel)) continue;
  const revision = sha256(file);
  const url = `/${rel}`;
  const cacheKey = `${url}?__pcv=${revision.slice(0, 12)}`;
  entries.push({ url, revision, cacheKey });
  totalBytes += statSync(file).size;
}

if (entries.length === 0) {
  console.error('build_pwa_precache: dist/ is empty — run vite build first');
  process.exit(1);
}

const payload = `self.__postclipPrecache = ${JSON.stringify(entries)};\n`;
writeFileSync(join(DIST, 'precache-manifest.js'), payload);
console.log(
  `precache-manifest.js: ${entries.length} entries, ${(totalBytes / 1e6).toFixed(1)} MB of build output ` +
    `(incl. ${(entries.filter((e) => e.url.startsWith('/ocr-assets/')).length)} ocr-assets)`,
);
