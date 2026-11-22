/**
 * Demo (S2): serve the built dist/ and run the end-to-end demo flows in
 * real Chromium and WebKit — pick a fixture, real in-browser OCR, cleaned
 * review text (chrome removed), edit, Web Share payload (spied), Copy +
 * paste round-trip, a real .txt export download read back, the non-English
 * rejection, the tiny-input error, a final no-storage sweep, then the S2
 * channels: service-worker shell ready, paste event, share-target POST
 * through the worker, offline reload + offline OCR, and (Chromium) the
 * denied-clipboard explanation with the picker still working. Prints
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

    // S2 (A11): wait for the service worker and its COMPLETE precache FIRST,
    // on the fresh network stack, before the OCR-heavy flows: every later
    // OCR asset load is then served by the worker instead of re-downloading
    // ~28 MB per page load through the browser's network process (which
    // wedged Playwright WebKit on Linux under exactly that repeated load —
    // the failing CI run and the first local demo run, see the PR thread).
    // The e2e suite proves the same readiness with a 120 s budget
    // (a11_installable_manifest_and_sw_registered); the demo polls 90 s.
    let swReady = null;
    for (let i = 0; i < 90; i++) {
      swReady = await page.evaluate(async () => {
        let manifestCount = -1;
        let cachedCount = -1;
        let active = false;
        try {
          const text = await (await fetch('/precache-manifest.js')).text();
          manifestCount = JSON.parse(text.slice(text.indexOf('['), text.lastIndexOf(']') + 1)).length;
        } catch {
          // precache manifest not readable (yet) — treated as -1 entries
        }
        try {
          const names = await caches.keys();
          const shell = names.find((n) => n.startsWith('precache'));
          if (shell) cachedCount = (await (await caches.open(shell)).keys()).length;
        } catch {
          // Cache Storage unavailable — treated as -1 entries
        }
        const reg = await navigator.serviceWorker.getRegistration();
        active = !!reg && !!reg.active;
        return { manifestCount, cachedCount, active };
      });
      if (swReady.active && swReady.cachedCount === swReady.manifestCount) break;
      await sleep(1000);
    }
    step(
      'installable: service worker registered with a complete precache',
      swReady.active && swReady.cachedCount === swReady.manifestCount,
      JSON.stringify(swReady),
    );

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
    await page.locator('#export-menu summary').click(); // open the export menu
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

    // A15: the no-storage sweep. S2 adds the service-worker app shell, so the
    // allow-listed app-shell precache cache may exist — and nothing else
    // (no local/session storage, no cookies; the model cache arrives in S3).
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
      'no-storage audit: only the allow-listed app-shell cache exists',
      storage.localStorageKeys.length === 0 &&
        storage.sessionStorageKeys.length === 0 &&
        storage.cookies === '' &&
        storage.cacheNames.every((n) => n.startsWith('precache')),
      `caches: ${storage.cacheNames.join(',') || 'none'}`,
    );

    // S2 (UC03): a paste EVENT carrying an image file is processed.
    const pasteBytes = readFileSync(fixturePath('clean02')).toString('base64');
    await page.goto(`http://127.0.0.1:${PORT}/`);
    // Wait for the app's post-paint paste listener (avoids the startup race).
    await page.waitForSelector('#paste-btn');
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 50))),
    );
    await page.evaluate((b64) => {
      const buf = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const dt = new DataTransfer();
      dt.items.add(new File([buf], 'pasted.png', { type: 'image/png' }));
      document.dispatchEvent(
        new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }),
      );
    }, pasteBytes);
    let pastedText = '';
    for (let i = 0; i < 150; i++) {
      pastedText = await page.locator('#review-text').inputValue().catch(() => '');
      if (pastedText.length > 0) break;
      await sleep(1000);
    }
    step('paste event with an image file is processed end to end', pastedText.length > 40, `${pastedText.length} chars`);

    // S2 (UC02): a multipart POST through the service worker hands the
    // shared image to the pipeline (the Android share-sheet simulation).
    const sharedBytes = readFileSync(fixturePath('clean03')).toString('base64');
    await page.goto(`http://127.0.0.1:${PORT}/`);
    for (let i = 0; i < 30; i++) {
      const ready = await page.evaluate(async () => {
        const reg = await navigator.serviceWorker.getRegistration();
        if (!reg?.active) return false;
        const names = await caches.keys();
        const shell = names.find((n) => n.startsWith('precache'));
        const text = await (await fetch('/precache-manifest.js')).text();
        const want = JSON.parse(text.slice(text.indexOf('['), text.lastIndexOf(']') + 1)).length;
        const got = shell ? (await (await caches.open(shell)).keys()).length : -1;
        return got === want;
      }).catch(() => false);
      if (ready) break;
      await sleep(1000);
    }
    const sharePost = await page.evaluate(async (b64) => {
      const buf = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const body = new FormData();
      body.append('image', new File([buf], 'shared.png', { type: 'image/png' }));
      // Bounded: a wedged network stack must fail this step in 30 s, not
      // hang a CI runner for an hour (observed once in the CI failure log).
      const res = await fetch('/share-target', { method: 'POST', body, signal: AbortSignal.timeout(30000) });
      return res.ok;
    }, sharedBytes);
    let sharedText = '';
    for (let i = 0; i < 150; i++) {
      sharedText = await page.locator('#review-text').inputValue().catch(() => '');
      if (sharedText.length > 0) break;
      await sleep(1000);
    }
    step(
      'share-target POST through the service worker is processed',
      sharePost && sharedText.length > 40,
      `${sharedText.length} chars`,
    );

    // S2 (UC04): after the first load, the network is disabled and the app
    // shell still loads — and a pick runs real OCR entirely offline.
    await page.goto(`http://127.0.0.1:${PORT}/`);
    await sleep(1500); // let the (already active) worker control this page
    await context.setOffline(true);
    await page.reload();
    const offlineHome = await page.getByRole('heading', { name: 'PostClip' }).isVisible().catch(() => false);
    step('offline reload renders the app shell', offlineHome);
    let offlineText = '';
    if (offlineHome) {
      await page.setInputFiles('#file-input', fixturePath('clean05'));
      for (let i = 0; i < 150; i++) {
        offlineText = await page.locator('#review-text').inputValue().catch(() => '');
        if (offlineText.length > 0) break;
        await sleep(1000);
      }
    }
    step('real OCR works with the network disabled', offlineText.length > 40, `${offlineText.length} chars`);
    await context.setOffline(false);

    // S2 (UC03/UC12, chromium only): the Paste button reads the REAL
    // clipboard; with the grant revoked the button explains and the picker
    // still works (A10). WebKit grants no clipboard permissions at all
    // (recorded in docs/evidence/S2/webkit-paste-probe.log).
    if (engineName === 'chromium') {
      const deniedContext = await browser.newContext({ acceptDownloads: true });
      const deniedPage = await deniedContext.newPage();
      await deniedPage.goto(`http://127.0.0.1:${PORT}/`);
      const clipBytes = readFileSync(fixturePath('clean04')).toString('base64');
      await deniedPage.evaluate(async (b64) => {
        const buf = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        await navigator.clipboard.write([
          new ClipboardItem({ 'image/png': new Blob([buf], { type: 'image/png' }) }),
        ]);
      }, clipBytes).catch(() => {});
      await deniedPage.locator('#paste-btn').click();
      const explained = await deniedPage
        .getByText('blocked for this site')
        .isVisible()
        .catch(() => false);
      await deniedPage.setInputFiles('#file-input', fixturePath('clean01'));
      let pickerText = '';
      for (let i = 0; i < 150; i++) {
        pickerText = await deniedPage.locator('#review-text').inputValue().catch(() => '');
        if (pickerText.length > 0) break;
        await sleep(1000);
      }
      step(
        'denied clipboard explains and the file picker still works',
        explained && pickerText.length > 40,
        `explained=${explained}`,
      );
      await deniedContext.close();
    }
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
