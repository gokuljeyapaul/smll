#!/usr/bin/env node
/**
 * Owner-visual gallery capture (S3 — plan Conformance O03): phone-viewable
 * screenshots from a REAL passing run, committed under
 * docs/evidence/S3/owner/ with a gallery.md. What the owner confirms
 * (plan row O03): "A non-technical person would understand what is
 * happening and what they still get" — the model download progress, the
 * checksum failure, and the fallback banner.
 *
 * Run against the TEST build (npm run build:test) — the flows use the
 * test-only model-server URL override. Chromium only (owner-visual is
 * about the words and states, not the engine; the engine matrix is the
 * e2e suite's job).
 *
 * Usage: node scripts/capture_owner_gallery_s3.mjs
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const PORT = 4290;
const MODEL_PORT = 4599;
const OUT = join(ROOT, 'docs/evidence/S3/owner');
const MODEL_SERVER = `http://127.0.0.1:${MODEL_PORT}`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Clear the model cache in the page so a gallery step can exercise a fresh
 *  download (the cache key is content-addressed — a cached good model would
 *  short-circuit the failure-variant steps to ready). */
async function clearModelCache(page) {
  await page.evaluate(async () => {
    try {
      const root = await navigator.storage.getDirectory();
      await root.removeEntry('postclip-model', { recursive: true });
    } catch { /* no OPFS model dir on this engine */ }
    try {
      const names = await caches.keys();
      for (const n of names) if (n.startsWith('postclip-model')) await caches.delete(n);
    } catch { /* no Cache Storage model cache */ }
  });
}

async function waitUp(url, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  let lastErr = 'unknown';
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
      lastErr = `HTTP ${res.status}`;
    } catch (err) {
      lastErr = String(err);
    }
    await sleep(250);
  }
  throw new Error(`server did not come up at ${url} (last error: ${lastErr})`);
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const preview = spawn(
    process.execPath,
    ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--host', '127.0.0.1', '--strictPort'],
    { cwd: ROOT, stdio: ['ignore', 'ignore', 'inherit'] },
  );
  const modelServer = spawn(
    process.execPath,
    [
      join('scripts', 'serve_model.mjs'),
      '--port',
      String(MODEL_PORT),
      '--file',
      join('.cache/models', 'Qwen3-0.6B-Q4_K_M.gguf'),
      '--log',
      join('artifacts', 'model-server-owner.log'),
    ],
    { cwd: ROOT, stdio: ['ignore', 'ignore', 'inherit'] },
  );
  const shots = [];
  try {
    await waitUp(`http://127.0.0.1:${PORT}/`);
    await waitUp(`${MODEL_SERVER}/healthz`);
    console.log(`gallery: app at http://127.0.0.1:${PORT}/ ; model server at ${MODEL_SERVER}`);

    const browser = await chromium.launch();
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 }, // phone-sized, like the O05 mobile pass
      permissions: ['clipboard-read', 'clipboard-write'],
    });
    const page = await context.newPage();

    // 1. Download progress, mid-flight (the paced /model-slow variant).
    await page.goto(`http://127.0.0.1:${PORT}/?testModelUrl=${MODEL_SERVER}/model-slow`);
    await page.locator('#model-download-btn').click();
    let progressShot = false;
    for (let i = 0; i < 300 && !progressShot; i++) {
      const pct = Number(await page.getByRole('progressbar').getAttribute('aria-valuenow').catch(() => null));
      if (pct >= 25 && pct <= 90) {
        await page.screenshot({ path: join(OUT, '01-model-download-progress.png') });
        shots.push(['01-model-download-progress.png', `Downloading the tidy-up model — live progress bar at ${pct}% (of 377.0 MiB), downloaded once and then offline forever.`]);
        progressShot = true;
      }
      await sleep(150);
    }
    if (!progressShot) throw new Error('never observed intermediate download progress');
    await page.locator('#model-ready').waitFor({ timeout: 120_000 });
    await page.screenshot({ path: join(OUT, '02-model-ready.png') });
    shots.push(['02-model-ready.png', 'Download finished and verified — the tidy-up model is ready and works offline.']);

    // 2. Checksum failure (the /model-wrong-hash variant) — from a fresh page.
    await clearModelCache(page);
    await page.goto(`http://127.0.0.1:${PORT}/?testModelUrl=${MODEL_SERVER}/model-wrong-hash`);
    await page.locator('#model-download-btn').click();
    await page.locator('#model-banner').waitFor({ timeout: 120_000 });
    await page.screenshot({ path: join(OUT, '03-model-checksum-failure.png') });
    shots.push(['03-model-checksum-failure.png', 'The download did not pass its integrity check — it was not kept, and the banner says what still works.']);

    // 3. What they still get: the same app, a pick, standard cleanup.
    await page.setInputFiles('#file-input', join(ROOT, 'fixtures/images/clean01.png'));
    await page.getByRole('heading', { name: 'Review' }).waitFor({ timeout: 120_000 });
    await page
      .locator('#review-text')
      .waitFor({ state: 'visible', timeout: 120_000 });
    await sleep(1500); // let the review text settle in
    await page.screenshot({ path: join(OUT, '04-standard-cleanup-still-works.png') });
    shots.push(['04-standard-cleanup-still-works.png', 'Everything still works without the model: the screenshot was read and cleaned up with the standard rules (the review screen says so).']);

    // 4. The unsupported-browser fallback banner (the test-only probe override).
    await page.goto(`http://127.0.0.1:${PORT}/?testProbe=unsupported`);
    await page.locator('#model-banner').waitFor({ timeout: 30_000 });
    await page.screenshot({ path: join(OUT, '05-fallback-banner-unsupported.png') });
    shots.push(['05-fallback-banner-unsupported.png', "A browser that cannot run the model gets a plain-language banner — PostClip still cleans posts with the standard rules."]);

    await context.close();
    await browser.close();
  } finally {
    preview.kill('SIGTERM');
    modelServer.kill('SIGTERM');
  }

  const md = [
    '# S3 owner gallery — the tidy-up model (O03)',
    '',
    'Real screenshots from a passing run of the built app (Chromium, phone-sized viewport).',
    'The tidy-up model is optional: PostClip works fully without it — these screens show',
    'the download, what happens when it fails, and what you still get.',
    '',
    ...shots.flatMap(([file, caption]) => [`## ${file}`, '', `![${file}](${file})`, '', `${caption}`, '']),
    '',
    'What to check (plan row O03): a non-technical person would understand what is',
    'happening and what they still get — a visible download with progress, a clear',
    'message when the file fails its check, and the app still reading and cleaning',
    'posts either way.',
    '',
  ].join('\n');
  writeFileSync(join(OUT, 'gallery.md'), md);
  console.log(`gallery: wrote ${shots.length} screenshots + gallery.md to docs/evidence/S3/owner/`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
