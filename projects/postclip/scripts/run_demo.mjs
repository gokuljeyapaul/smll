/**
 * Demo (S1): serve the built dist/ and run the end-to-end demo flows in
 * real Chromium and WebKit — pick a fixture, real in-browser OCR, cleaned
 * review text (chrome removed), edit, Web Share payload (spied), Copy +
 * paste round-trip, a real .txt export download read back, the non-English
 * rejection, the tiny-input error, and a final no-storage sweep. Prints
 * honest per-step results and exits non-zero on any failure.
 *
 * Usage: node scripts/run_demo.mjs   (part of `npm run demo` / demo.sh)
 */
import { chromium, webkit } from 'playwright';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const PORT = 4197;

const MANIFEST = JSON.parse(readFileSync(join(ROOT, 'fixtures/manifest.json'), 'utf-8'));
const fixturePath = (id) => {
  const entry = MANIFEST.images.find((i) => i.id === id);
  if (!entry) throw new Error(`demo: fixture ${id} missing from the manifest`);
  return join(ROOT, 'fixtures', entry.file);
};
const gold = (id) => JSON.parse(readFileSync(join(ROOT, 'fixtures/gold', `${id}.json`), 'utf-8'));

// The app's own user-facing strings (imported from the committed fixtures'
// gold expectations where possible; the message strings are the contract
// the e2e suite asserts, mirrored here for the demo narrative).
const NON_ENGLISH_MESSAGE =
  'PostClip reads posts written in English only for now. This screenshot looks like it is written in another language, so it was not processed.';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitUp() {
  await sleep(2000); // vite preview needs a moment to bind
  let firstErr = null;
  for (let i = 0; i < 90; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/`);
      if (res.ok) return;
    } catch (err) {
      firstErr ??= String(err.cause?.code ?? err.message);
    }
    await sleep(500);
  }
  throw new Error(`demo: preview server did not start (last error: ${firstErr})`);
}

async function pickAndWait(page, id) {
  await page.goto('http://127.0.0.1:4197/');
  await page.setInputFiles('#file-input', fixturePath(id));
  let text = '';
  for (let i = 0; i < 150; i++) {
    text = await page.locator('#review-text').inputValue();
    if (text.length > 0) break;
    await sleep(1000);
  }
  return text;
}

async function demoIn(engineName, browserType) {
  const browser = await browserType.launch();
  // Chromium needs explicit clipboard permissions (as in playwright.config.ts);
  // Playwright WebKit supports no clipboard permissions at all — it needs none.
  // Both engines take real downloads in the demo (acceptDownloads).
  const options =
    engineName === 'chromium'
      ? { permissions: ['clipboard-read', 'clipboard-write'], acceptDownloads: true }
      : { acceptDownloads: true };
  const context = await browser.newContext(options);
  const page = await context.newPage();
  const steps = [];
  const step = (name, ok, detail) => {
    steps.push({ name, ok, detail });
    console.log(`  [${engineName}] ${ok ? 'PASS' : 'FAIL'} — ${name}${detail ? ` (${detail})` : ''}`);
  };

  await page.addInitScript(() => {
    const w = window;
    w.__shareCalls = [];
    Object.defineProperty(navigator, 'share', {
      value: (data) => {
        w.__shareCalls.push(data);
        return Promise.resolve();
      },
      configurable: true,
      writable: true,
    });
  });

  try {
    await page.goto(`http://127.0.0.1:${PORT}/`);
    const title = await page.getByRole('heading', { name: 'PostClip' }).isVisible();
    step('home screen renders', title);

    // S1 flow: pick → real OCR → CLEANED review text.
    const cleaned = await pickAndWait(page, 'clean01');
    step('real OCR + cleanup produce review text', cleaned.length > 40, `${cleaned.length} chars`);
    const clean01Gold = gold('clean01');
    step(
      'review text is the cleaned body (first gold body line present)',
      cleaned.includes(clean01Gold.body[0]),
      `'${clean01Gold.body[0]}'`,
    );
    step(
      'UI chrome is removed from the review text',
      !cleaned.includes('Like Comment Share') && !cleaned.includes('reactions'),
    );

    // A04: edits flow into every payload.
    const edited = `${cleaned}\n\nEdited while reviewing — the demo checks every payload.`;
    await page.locator('#review-text').fill(edited);
    await page.locator('#share-btn').click();
    const shareCalls = await page.evaluate(() => window.__shareCalls);
    step('Web Share payload equals the edited text', shareCalls.length === 1 && shareCalls[0].text === edited);

    await page.locator('#copy-btn').click();
    await page.waitForSelector('text=Copied', { timeout: 10_000 });
    step('Copy shows feedback', true);
    await page.evaluate(() => {
      const ta = document.createElement('textarea');
      ta.id = 'demo-paste-target';
      ta.style.cssText = 'position:fixed;bottom:4px;left:4px;width:180px;height:28px;z-index:9999;';
      document.body.appendChild(ta);
    });
    await page.locator('#demo-paste-target').click();
    await page.keyboard.press('ControlOrMeta+V');
    const pasted = await page.locator('#demo-paste-target').inputValue();
    step('clipboard paste round-trip delivers the edited text', pasted === edited, `${pasted.length} chars`);

    // A05: a real .txt export download whose content is read back.
    const downloadPromise = page.waitForEvent('download');
    await page.locator('#export-txt').click();
    const download = await downloadPromise;
    const exported = readFileSync(await download.path(), 'utf-8');
    step(
      'export .txt downloads the edited text exactly',
      download.suggestedFilename() === 'postclip-export.txt' && exported === edited,
      exported.length === edited.length ? 'byte-identical' : 'MISMATCH',
    );

    // A06: the German fixture is rejected with the clear message, no review.
    await page.goto(`http://127.0.0.1:${PORT}/`);
    await page.setInputFiles('#file-input', fixturePath('de01'));
    await page.waitForSelector('.error-banner', { timeout: 120_000 });
    const banner = await page.locator('.error-banner').textContent();
    step('non-English screenshot is rejected with a clear message', banner === NON_ENGLISH_MESSAGE);
    step('no cleanup ran for the rejected screenshot', (await page.locator('#review-text').count()) === 0);

    // A07: the tiny fixture gets its own specific message.
    await page.setInputFiles('#file-input', fixturePath('tiny01'));
    await page.waitForFunction(
      () => document.querySelector('.error-banner')?.textContent?.includes('too small'),
      undefined,
      { timeout: 60_000 },
    );
    step('tiny image is rejected before OCR with the too-small message', true);

    // A15: the no-storage sweep (only allow-listed storage; nothing written).
    const storage = await page.evaluate(async () => {
      let cacheNames = [];
      try {
        if (typeof caches !== 'undefined') cacheNames = await caches.keys();
      } catch {
        cacheNames = [];
      }
      return {
        localStorageKeys: Object.keys(localStorage),
        sessionStorageKeys: Object.keys(sessionStorage),
        cacheNames,
        cookies: document.cookie,
      };
    });
    step(
      'no-storage audit: nothing persisted anywhere',
      storage.localStorageKeys.length === 0 &&
        storage.sessionStorageKeys.length === 0 &&
        storage.cacheNames.length === 0 &&
        storage.cookies === '',
    );
  } catch (err) {
    step('demo flow completed without errors', false, String(err));
  } finally {
    await context.close();
    await browser.close();
  }
  return steps.every((s) => s.ok);
}

async function main() {
  const preview = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--host', '127.0.0.1', '--strictPort'], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  preview.stdout.on('data', (d) => console.error(`[preview-out] ${d.toString().trim()}`));
  preview.stderr.on('data', (d) => console.error(`[preview] ${d.toString().trim()}`));
  preview.on('error', (err) => console.error(`[preview] spawn error: ${err}`));
  preview.on('exit', (code, sig) => console.error(`[preview] exited code=${code} sig=${sig}`));
  try {
    await waitUp();
    console.log(`demo: serving built app at http://127.0.0.1:${PORT}/`);
    const okChrome = await demoIn('chromium', chromium);
    const okWebkit = await demoIn('webkit', webkit);
    console.log(`demo: chromium=${okChrome ? 'PASS' : 'FAIL'} webkit=${okWebkit ? 'PASS' : 'FAIL'}`);
    process.exitCode = okChrome && okWebkit ? 0 : 1;
  } finally {
    preview.kill('SIGTERM');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
