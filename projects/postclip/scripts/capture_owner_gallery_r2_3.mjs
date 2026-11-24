#!/usr/bin/env node
/**
 * Owner-visual gallery capture (R2-3 — plan Conformance O09): phone-viewable
 * mobile-viewport screenshots from a REAL passing run, committed under
 * docs/evidence/R2-3/owner/ with a gallery.md.
 *
 * What the owner confirms (plan row O09): "The 397 MB download is never
 * pushed at anyone; the model, once downloaded, is remembered across
 * restarts; the ephemeral/lost-cache case is explained kindly" — captured
 * at BOTH 390×844 and 360×800:
 *   1. the home screen with the model NOT offered (fresh profile — the
 *      collapsed "Advanced: optional tidy-up model" section is the only
 *      trace of the model);
 *   2. the Advanced section OPENED: the honest one-time-download offer,
 *      visible only because the user chose to look;
 *   3. the "ready (cached)" state AFTER A RESTART: one real download in a
 *      REAL persistent profile, the browser fully closed and relaunched on
 *      the same profile dir — the small state line, never a download button;
 *   4. (bonus) the volatile-storage explanation: the kind message that
 *      replaces the download when the storage cannot keep the model.
 *
 * Runs against the TEST build (npm run build:test) in Chromium with the REAL
 * pinned model file served locally (one real download; the engine matrix is
 * the e2e suite's job).
 *
 * Usage: node scripts/capture_owner_gallery_r2_3.mjs   (after npm run build:test)
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/* global TextEncoder, Response */
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const PORT = 4297;
const MODEL_PORT = 4619;
const OUT = join(ROOT, 'docs/evidence/R2-3/owner');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitUp(url, timeoutMs = 60_000) {
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
    await sleep(400);
  }
  throw new Error(`server did not come up at ${url} (last error: ${lastErr})`);
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const modelFile = join(ROOT, '.cache/models', 'Qwen3-0.6B-Q4_K_M.gguf');
  if (!existsSync(modelFile)) {
    throw new Error(`pinned model file missing: ${modelFile} — run "node scripts/fetch_model.mjs" first`);
  }
  const modelServer = spawn(
    process.execPath,
    [join('scripts', 'serve_model.mjs'), '--port', String(MODEL_PORT), '--file', modelFile],
    { cwd: ROOT, stdio: ['ignore', 'ignore', 'inherit'], detached: true },
  );
  const preview = spawn(
    process.execPath,
    ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--host', '127.0.0.1', '--strictPort'],
    { cwd: ROOT, stdio: ['ignore', 'ignore', 'inherit'], detached: true },
  );
  const browser = await chromium.launch();
  const shots = [];
  try {
    await waitUp(`http://127.0.0.1:${MODEL_PORT}/healthz`);
    await waitUp(`http://127.0.0.1:${PORT}/`);
    const base = `http://127.0.0.1:${PORT}/`;
    const modelUrl = `http://127.0.0.1:${MODEL_PORT}/model`;

    // The REAL download happens once, in a persistent profile reused across
    // viewports (the second viewport's "after restart" shot reuses it).
    const readyProfile = mkdtempSync(join(tmpdir(), 'postclip-o09-ready-'));

    for (const [tag, width, height] of [
      ['390x844', 390, 844],
      ['360x800', 360, 800],
    ]) {
      // --- 1+2: a FRESH profile — the model is not offered by default ----
      const freshProfile = mkdtempSync(join(tmpdir(), 'postclip-o09-fresh-'));
      let ctx = await browser.launchPersistentContext(freshProfile, { viewport: { width, height } });
      let page = ctx.pages()[0] ?? (await ctx.newPage());
      await page.goto(base);
      await page.locator('#app-title').waitFor({ timeout: 30_000 });
      await sleep(600); // let the layout settle

      const notOffered = `o09-${tag}-home-model-not-offered.png`;
      await page.screenshot({ path: join(OUT, notOffered), fullPage: true });
      shots.push([notOffered, `The home screen (${tag}), fresh profile: no model card, no download button — the only trace of the model is the collapsed "Advanced" section`]);

      await page.locator('#advanced-model summary').click();
      await sleep(300);
      const advanced = `o09-${tag}-advanced-section-open.png`;
      await page.screenshot({ path: join(OUT, advanced), fullPage: true });
      shots.push([advanced, `The Advanced section opened (${tag}): the honest one-time-download offer, visible only because you chose to look`]);
      await ctx.close();

      // --- 4: the volatile-storage explanation (kind, no download) ------
      ctx = await browser.launchPersistentContext(mkdtempSync(join(tmpdir(), 'postclip-o09-volatile-')), {
        viewport: { width, height },
      });
      page = ctx.pages()[0] ?? (await ctx.newPage());
      await page.goto(`${base}?testStorage=volatile&testModelUrl=${modelUrl}`);
      await page.locator('#app-title').waitFor({ timeout: 30_000 });
      await page.locator('#advanced-model summary').click();
      await page.locator('#model-banner').waitFor({ timeout: 30_000 });
      const volatile = `o09-${tag}-volatile-explanation.png`;
      await page.screenshot({ path: join(OUT, volatile), fullPage: true });
      shots.push([volatile, `Volatile storage (${tag}): the kind explanation replaces the download — no 397 MB that would be lost`]);
      await ctx.close();

      // --- 3: download ONCE, close the browser, RESTART: ready (cached) --
      let first = tag === '390x844'; // only the first viewport pays the download
      if (first) {
        ctx = await browser.launchPersistentContext(readyProfile, { viewport: { width, height } });
        page = ctx.pages()[0] ?? (await ctx.newPage());
        await page.goto(`${base}?testModelUrl=${modelUrl}`);
        await page.locator('#advanced-model summary').click();
        await page.locator('#model-download-btn').click();
        await page.locator('#model-ready').waitFor({ timeout: 300_000 });
        await ctx.close(); // the browser is FULLY closed
      }
      // Reopen on the SAME profile dir: the model is remembered.
      ctx = await browser.launchPersistentContext(readyProfile, { viewport: { width, height } });
      page = ctx.pages()[0] ?? (await ctx.newPage());
      await page.goto(base);
      await page.locator('#model-ready').waitFor({ timeout: 60_000 });
      await sleep(400);
      const readyShot = `o09-${tag}-ready-cached-after-restart.png`;
      await page.screenshot({ path: join(OUT, readyShot), fullPage: true });
      shots.push([readyShot, `After closing and reopening the browser (${tag}): "Tidy-up model ready (cached)" — remembered, no re-download, no download button`]);
      await ctx.close();
    }

    const rows = shots
      .map(([file, caption]) => `### ${caption}\n![${caption.replace(/[()]/g, '')}](../owner/${file})\n`)
      .join('\n');
    writeFileSync(
      join(OUT, 'gallery.md'),
      `# O09 owner gallery — R2-3: the model downloads once (issue #78)\n\n` +
        `Real screenshots from a passing run of the test build (Chromium, phone viewports; one real download of the pinned model in a persistent profile; the full e2e matrix is in docs/evidence/R2-3/).\n\n` +
        rows +
        `\n---\n\n**What you confirm (reply \`O09 ok\` or \`O09 no: <why>\`):** the 397 MB download is never pushed at anyone; the model, once downloaded, is remembered across restarts; the ephemeral/lost-cache case is explained kindly.\n`,
    );
    console.log(`O09 gallery: ${shots.length} screenshots + gallery.md under docs/evidence/R2-3/owner/`);
  } finally {
    await browser.close().catch(() => {});
    try {
      process.kill(-preview.pid, 'SIGTERM');
    } catch {}
    try {
      process.kill(-modelServer.pid, 'SIGTERM');
    } catch {}
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
