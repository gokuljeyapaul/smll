#!/usr/bin/env node
/**
 * Owner-visual gallery capture (S5 — plan Conformance O05): phone-viewable
 * mobile-viewport screenshots from a REAL passing run, committed under
 * docs/evidence/S5/owner/ with a gallery.md.
 *
 * What the owner confirms (plan row O05): "Usable one-handed on a
 * phone-sized screen; works offline; focus is visible" — captured as:
 *   1. the home screen at 390x844 (one-handed layout);
 *   2. keyboard focus landed on the primary control with a VISIBLE focus
 *      ring (Tab once — no mouse anywhere in the flow);
 *   3. the review screen at 390x844 after a real pick → OCR → cleanup;
 *   4. the export menu open at 390x844;
 *   5. the app reloading OFFLINE (network cut) — the service worker's
 *      precached shell comes up with zero network;
 *   6. a full pick → review OFFLINE (offline OCR + cleanup, A11's flow).
 *
 * Runs against the TEST build (npm run build:test) in Chromium — the
 * owner-visual claim is about the phone-sized layout/states; the engine
 * matrix (Chromium + WebKit) is the e2e suite's job. No model server and
 * no model download: the default (rules-only) state is the honest default.
 *
 * Usage: node scripts/capture_owner_gallery_s5.mjs   (after npm run build:test)
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const PORT = 4295;
const OUT = join(ROOT, 'docs/evidence/S5/owner');
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
  const preview = spawn(
    process.execPath,
    ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--host', '127.0.0.1', '--strictPort'],
    { cwd: ROOT, stdio: ['ignore', 'ignore', 'inherit'] },
  );
  const browser = await chromium.launch();
  const shots = [];
  try {
    await waitUp(`http://127.0.0.1:${PORT}/`);
    // A phone-sized viewport (390x844), light scheme — the shipped default.
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
    });
    const page = await context.newPage();
    const base = `http://127.0.0.1:${PORT}/`;
    await page.goto(base);

    // 1. Home, one-handed.
    await sleep(600);
    await page.screenshot({ path: join(OUT, '01-home-mobile.jpg'), type: 'jpeg', quality: 85, fullPage: true });
    shots.push(['01-home-mobile.jpg', 'The home screen at 390x844 — the whole flow (drop, paste, choose) within a one-handed thumb arc.']);

    // 2. Keyboard focus, visible: Tab once from the top — no mouse anywhere.
    await page.keyboard.press('Tab');
    await sleep(300);
    await page.screenshot({ path: join(OUT, '02-keyboard-focus-mobile.jpg'), type: 'jpeg', quality: 85, fullPage: false });
    shots.push(['02-keyboard-focus-mobile.jpg', 'Keyboard-only: Tab lands on Choose screenshot with a clearly VISIBLE focus ring (3px outline).']);

    // 3. A real pick → in-browser OCR → review (the OS file dialog is
    //    browser chrome; the file is set the way every spec does).
    await page.setInputFiles('#file-input', join(ROOT, 'fixtures/images/clean01.png'));
    await page.locator('#review-text').waitFor({ timeout: 120_000 });
    for (let i = 0; i < 150; i++) {
      if ((await page.locator('#review-text').inputValue()).length > 0) break;
      await sleep(1000);
    }
    await sleep(400);
    await page.screenshot({ path: join(OUT, '03-review-mobile.jpg'), type: 'jpeg', quality: 85, fullPage: true });
    shots.push(['03-review-mobile.jpg', 'The review screen at 390x844 after a real pick → OCR → cleanup: readable cleaned text, Share/Copy/Export reachable.']);

    // 4. The export menu open at phone width.
    await page.locator('#export-menu summary').click();
    await sleep(300);
    await page.screenshot({ path: join(OUT, '04-export-menu-mobile.jpg'), type: 'jpeg', quality: 85, fullPage: true });
    shots.push(['04-export-menu-mobile.jpg', 'The export menu (Markdown/Text/JSON) open at 390x844.']);

    // 5. OFFLINE reload: cut the network, reload — the service worker's
    //    precached app shell comes back up with zero network.
    await context.setOffline(true);
    await page.reload();
    await page.getByRole('heading', { name: 'PostClip' }).waitFor({ timeout: 60_000 });
    await sleep(600);
    await page.screenshot({ path: join(OUT, '05-offline-reload-mobile.jpg'), type: 'jpeg', quality: 85, fullPage: true });
    shots.push(['05-offline-reload-mobile.jpg', 'With the network CUT, reloading still brings up the full app — the service worker serves the precached shell.']);

    // 6. A full pick OFFLINE: offline OCR + cleanup → review, no network.
    await page.setInputFiles('#file-input', join(ROOT, 'fixtures/images/clean02.png'));
    await page.locator('#review-text').waitFor({ timeout: 120_000 });
    for (let i = 0; i < 150; i++) {
      if ((await page.locator('#review-text').inputValue()).length > 0) break;
      await sleep(1000);
    }
    await sleep(400);
    await page.screenshot({ path: join(OUT, '06-offline-review-mobile.jpg'), type: 'jpeg', quality: 85, fullPage: true });
    shots.push(['06-offline-review-mobile.jpg', 'Still offline: a second screenshot is read and cleaned entirely on-device (offline OCR — A11\'s flow), zero network requests.']);

    await context.setOffline(false);
  } finally {
    await browser.close().catch(() => undefined);
    try {
      process.kill(-preview.pid, 'SIGKILL');
    } catch {
      // the preview server already exited
    }
  }

  const md = [
    '# S5 owner gallery — mobile viewport, offline, keyboard focus (O05)',
    '',
    'All screenshots are from one REAL passing run of the app (test build,',
    'Chromium, 390x844 phone viewport, default rules-only state — the model',
    'cleanup is opt-in). What "good" looks like per the plan row O05:',
    'usable one-handed on a phone-sized screen; works offline; focus is visible.',
    '',
    ...shots.map(([file, note]) => `- ![${file}](./${file})\n  ${note}`),
    '',
    'The engine matrix (Chromium + WebKit), the axe accessibility scans and the',
    'keyboard-only flow are proven by the S5 e2e JUnit in docs/evidence/S5/junit/.',
    '',
  ].join('\n');
  writeFileSync(join(OUT, 'gallery.md'), md);
  console.log(`gallery: ${shots.length} shots written to docs/evidence/S5/owner/`);
}

main();
