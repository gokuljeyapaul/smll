#!/usr/bin/env node
/**
 * Owner-visual gallery capture (R2-1 — plan Conformance O07): phone-viewable
 * mobile-viewport screenshots from a REAL passing run, committed under
 * docs/evidence/R2-1/owner/ with a gallery.md.
 *
 * What the owner confirms (plan row O07): "A shared screenshot goes straight
 * to its text with Copy as the obvious first action; nothing is in the way" —
 * captured as, at BOTH 390×844 and 360×800:
 *   1. a share ARRIVES: the multipart POST through the service worker (the
 *      same handler Android's share sheet hits) and the app starts reading
 *      BY ITSELF — the one clear progress state;
 *   2. the RESULT screen: the text with the large Copy button first (fully
 *      above the fold), then Share and the file-save menu, then Edit.
 * Plus (390×844): Copy pressed — the visible "Copied ✓" confirmation.
 *
 * Runs against the TEST build (npm run build:test) in Chromium — the
 * owner-visual claim is about the phone-sized share-first flow; the engine
 * matrix (Chromium + WebKit) is the e2e suite's job. No model server and no
 * model download: the default (rules-only) state is the honest default.
 *
 * Usage: node scripts/capture_owner_gallery_r2_1.mjs   (after npm run build:test)
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const PORT = 4297;
const OUT = join(ROOT, 'docs/evidence/R2-1/owner');
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

/** Wait until the service worker is active AND its precache is complete (the
 * same readiness A08/A32 require before posting through the worker). */
async function waitForShell(page) {
  for (let i = 0; i < 240; i++) {
    const ready = await page.evaluate(async () => {
      try {
        const reg = await navigator.serviceWorker.getRegistration();
        if (!reg || !(reg.active || reg.installing || reg.waiting)) return false;
        const names = await caches.keys();
        const shell = names.find((n) => n.startsWith('precache'));
        if (!shell) return false;
        return (await (await caches.open(shell)).keys()).length >= 20;
      } catch {
        return false;
      }
    });
    if (ready) return;
    await sleep(1000);
  }
  throw new Error('service worker / precache never became ready');
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const preview = spawn(
    process.execPath,
    ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--host', '127.0.0.1', '--strictPort'],
    { cwd: ROOT, stdio: ['ignore', 'ignore', 'inherit'], detached: true },
  );
  const browser = await chromium.launch();
  const shots = [];
  try {
    await waitUp(`http://127.0.0.1:${PORT}/`);
    const fixtureBytes = readFileSync(join(ROOT, 'fixtures/images/clean03.png'));
    const base = `http://127.0.0.1:${PORT}/`;

    for (const [tag, width, height] of [
      ['390x844', 390, 844],
      ['360x800', 360, 800],
    ]) {
      const context = await browser.newContext({
        viewport: { width, height },
        deviceScaleFactor: 2,
        isMobile: true,
        hasTouch: true,
        // The e2e suite's chromium project grants these; the Copy step needs
        // clipboard-write or the copy fails (fail closed) and no confirmation
        // is shown.
        permissions: ['clipboard-read', 'clipboard-write'],
      });
      const page = await context.newPage();
      await page.goto(base);
      await waitForShell(page);

      // A share ARRIVES: the real multipart POST through the service worker.
      const res = await page.evaluate(
        async (bytes) => {
          const body = new FormData();
          body.append('image', new File([bytes], 'shared.png', { type: 'image/png' }));
          const r = await fetch('/share-target', { method: 'POST', body });
          return r.ok;
        },
        new Uint8Array(fixtureBytes),
      );
      if (!res) throw new Error('the share-target POST failed');

      // The progress state: reading started BY ITSELF, no extra tap.
      await page.locator('[data-testid="reading-progress"]').waitFor({ timeout: 30_000 });
      await sleep(250);
      await page.screenshot({ path: join(OUT, `01-share-arrives-progress-${tag}.jpg`), type: 'jpeg', quality: 85, fullPage: false });
      shots.push([
        `01-share-arrives-progress-${tag}.jpg`,
        `A shared screenshot arrives (${tag}): PostClip starts reading it by itself — one clear progress state, no extra tap, no home screen on this path.`,
      ]);

      // The result: text with the large Copy first, above the fold.
      await page.getByRole('heading', { name: 'Your text' }).waitFor({ timeout: 150_000 });
      for (let i = 0; i < 150; i++) {
        if ((await page.locator('#review-text').inputValue()).length > 0) break;
        await sleep(1000);
      }
      await sleep(400);
      await page.screenshot({ path: join(OUT, `02-result-copy-first-${tag}.jpg`), type: 'jpeg', quality: 85, fullPage: false });
      shots.push([
        `02-result-copy-first-${tag}.jpg`,
        `The result screen (${tag}): your text with the large Copy button first — fully above the fold, unscrolled — then Share and Save-as-file, then Edit.`,
      ]);

      if (tag === '390x844') {
        await page.locator('#copy-btn').click();
        await page.locator('.copied-note').waitFor({ timeout: 30_000 });
        await sleep(250);
        await page.screenshot({ path: join(OUT, '03-copy-confirmation-390x844.jpg'), type: 'jpeg', quality: 85, fullPage: false });
        shots.push([
          '03-copy-confirmation-390x844.jpg',
          'Copy pressed at 390×844: the text is on the clipboard and the confirmation shows right next to the button.',
        ]);
      }
      await context.close();
    }
  } finally {
    await browser.close().catch(() => undefined);
    // The preview was spawned detached (its own process group) so the group
    // kill below actually lands; the direct kill is the belt-and-braces
    // fallback, and the explicit exit stops the child handle from keeping
    // this script's event loop alive after the work is done.
    try {
      process.kill(-preview.pid, 'SIGKILL');
    } catch {
      // not a group leader (or already gone)
    }
    try {
      preview.kill('SIGKILL');
    } catch {
      // already exited
    }
  }

  const md = [
    '# O07 — R2-1 share-first result screen (owner gallery)',
    '',
    'Real screenshots from a passing run of `node scripts/capture_owner_gallery_r2_1.mjs`',
    '(test build, Chromium, the service-worker share-target POST — the same handler',
    "Android's share sheet hits; the real installed-PWA share is the plan's A27 device pass).",
    'No model download: the default rules-only state is what ships by default.',
    '',
    ...shots.map(([file, caption]) => `![${file.replace(/\.jpg$/, '')}](${file})\n\n${caption}\n`),
  ].join('\n');
  writeFileSync(join(OUT, 'gallery.md'), md + '\n');
  console.log(`owner gallery written: ${shots.length} shots under ${OUT}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
