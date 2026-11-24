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
import { spawn, execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const PORT = 4197;

const MANIFEST = JSON.parse(readFileSync(join(ROOT, 'fixtures/manifest.json'), 'utf-8'));
// The pinned model size, read from the single source of truth (src/model/manifest.ts).
const MODEL_SIZE_BYTES = Number(
  readFileSync(join(ROOT, 'src/model/manifest.ts'), 'utf-8').match(/\bsizeBytes:\s*(\d+)/)?.[1],
);
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

/** Clear the model cache in the page (OPFS dir + postclip-model* caches) so
 *  a demo step can exercise a fresh download (the key is content-addressed —
 *  two variants of the same model share it). */
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
      'no-storage audit: only the allow-listed caches exist (app shell; model cache from S3)',
      storage.localStorageKeys.length === 0 &&
        storage.sessionStorageKeys.length === 0 &&
        storage.cookies === '' &&
        storage.cacheNames.every((n) => n.startsWith('precache') || n.startsWith('postclip-model')),
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
    const offlineHome = await page
      .getByRole('heading', { name: 'PostClip' })
      .waitFor({ timeout: 10_000 })
      .then(() => true)
      .catch(() => false);
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

    // S3 (UC08): first use downloads the pinned model with visible progress,
    // verifies sha256 and ends ready — the local server serves the REAL file,
    // paced so the progress bar is observable.
    await page.goto(`http://127.0.0.1:${PORT}/?testModelUrl=http://127.0.0.1:4599/model-slow`);
    await page.locator('#advanced-model summary').click(); // R2-3: opt-in section
    await page.locator('#model-download-btn').click();
    // Record every REAL progress-bar DOM state with a MutationObserver
    // (timer sampling starves while the streamed hash runs on the main
    // thread in WebKit; the observer sees the same commits the user does).
    const progressPcts = await page.evaluate(async () => {
      const pcts = [];
      const record = () => {
        const bar = document.querySelector('#model-progress');
        const v = bar && bar.getAttribute('aria-valuenow');
        if (v !== null) pcts.push(Number(v));
      };
      const observer = new MutationObserver(record);
      observer.observe(document.body, { subtree: true, childList: true, attributes: true });
      record();
      const deadline = Date.now() + 120_000;
      while (Date.now() < deadline) {
        if (document.querySelector('#model-ready') || document.querySelector('#model-banner')) break;
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
      observer.disconnect();
      return pcts;
    });
    const modelReady = progressPcts.length >= 0 && !!(await page.locator('#model-ready').count());
    step(
      'model download shows live progress and ends ready (UC08)',
      modelReady && progressPcts.some((p) => p > 0 && p < 100),
      `ready=${modelReady} maxSeen=${Math.max(...progressPcts, 0)}% samples=${progressPcts.length}`,
    );
    // The model cache lives in OPFS (Chromium) or Cache Storage (WebKit) —
    // the app probes and picks per engine (src/model/store.ts).
    const cachedBytes = await page.evaluate(async () => {
      let total = 0;
      let entries = 0;
      try {
        const root = await navigator.storage.getDirectory();
        const dir = await root.getDirectoryHandle('postclip-model');
        for await (const [name, handle] of dir.entries()) {
          entries += 1;
          total += (await handle.getFile()).size;
          void name;
        }
      } catch { /* no OPFS model dir to clear */ }
      try {
        const names = await caches.keys();
        const model = names.find((n) => n.startsWith('postclip-model'));
        if (model) {
          const cache = await caches.open(model);
          for (const k of await cache.keys()) {
            entries += 1;
            total += (await (await cache.match(k.url)).blob()).size;
          }
        }
      } catch { /* no Cache Storage model cache */ }
      return entries === 1 ? total : -entries;
    });
    step(
      'the model cache holds exactly one entry of the pinned size',
      cachedBytes === MODEL_SIZE_BYTES,
      `${cachedBytes} bytes (pinned ${MODEL_SIZE_BYTES})`,
    );

    // S3 (UC08): an interrupted download RESUMES — the server destroys every
    // fresh request after ~25%, so only a Range resume can reach ready.
    // The resume step must actually download: clear the model cache first
    // (the progress step cached the same content-addressed key).
    await clearModelCache(page);
    await page.goto(`http://127.0.0.1:${PORT}/?testModelUrl=http://127.0.0.1:4599/model-kill-fresh`);
    await page.locator('#advanced-model summary').click(); // R2-3: opt-in section
    await page.locator('#model-download-btn').click();
    const resumed = await page
      .locator('#model-ready')
      .waitFor({ timeout: 120000 })
      .then(() => true)
      .catch(() => false);
    step('an interrupted model download resumes and ends ready', resumed);

    // S3 (UC14): with the model cached, OFFLINE processing issues ZERO
    // network requests (responses served by the service worker are not
    // network — the same definition as e2e/helpers/network.ts).
    await page.goto(`http://127.0.0.1:${PORT}/?testModelUrl=http://127.0.0.1:4599/model-kill-fresh`);
    await sleep(1500);
    const netEvents = { failed: [], nonSw: [] };
    page.on('requestfailed', (r) => netEvents.failed.push(r.url()));
    page.on('response', (r) => {
      if (!r.fromServiceWorker()) netEvents.nonSw.push(r.url());
    });
    await context.setOffline(true);
    await page.reload();
    const offlineModelReady = await page
      .locator('#model-ready')
      .waitFor({ timeout: 60000 })
      .then(() => true)
      .catch(() => false);
    step('the cached model is found offline with no network', offlineModelReady);
    await page.setInputFiles('#file-input', fixturePath('clean02'));
    let offlineModelText = '';
    for (let i = 0; i < 150; i++) {
      offlineModelText = await page.locator('#review-text').inputValue().catch(() => '');
      if (offlineModelText.length > 0) break;
      await sleep(1000);
    }
    const cleanupModeOffline = await page.locator('#cleanup-mode').textContent().catch(() => '');
    step(
      'offline processing with the model cached still produces review text',
      offlineModelText.length > 40 && cleanupModeOffline.includes('Tidy-up model ready'),
      `${offlineModelText.length} chars`,
    );
    step(
      'offline processing issued ZERO network requests',
      netEvents.failed.length === 0 && netEvents.nonSw.length === 0,
      `failed=${netEvents.failed.length} nonSW=${netEvents.nonSw.length}`,
    );
    await context.setOffline(false);

    // S3 (UC09): a checksum mismatch leaves the app in fallback mode with
    // the explicit banner, the bad file purged — and a pick still works.
    // (Clear the cache first: the key is content-addressed and the good
    // model from the resume step would otherwise short-circuit to ready.)
    await clearModelCache(page);
    await page.goto(`http://127.0.0.1:${PORT}/?testModelUrl=http://127.0.0.1:4599/model-wrong-hash`);
    await page.locator('#advanced-model summary').click(); // R2-3: opt-in section
    await page.locator('#model-download-btn').click();
    const badModelBanner = await page
      .locator('#model-banner')
      .waitFor({ timeout: 120000 })
      .then(() => true)
      .catch(() => false);
    step('a checksum failure shows the fallback banner', badModelBanner);
    const modelPurged = await page.evaluate(async () => {
      const names = await caches.keys();
      const model = names.find((n) => n.startsWith('postclip-model'));
      if (!model) return true;
      const keys = await (await caches.open(model)).keys();
      return keys.length === 0;
    });
    step('the bad model file is purged from the cache', modelPurged);
    await page.setInputFiles('#file-input', fixturePath('clean03'));
    let fallbackText = '';
    for (let i = 0; i < 150; i++) {
      fallbackText = await page.locator('#review-text').inputValue().catch(() => '');
      if (fallbackText.length > 0) break;
      await sleep(1000);
    }
    const cleanupModeFallback = await page.locator('#cleanup-mode').textContent().catch(() => '');
    step(
      'standard cleanup still works after the model failure',
      fallbackText.length > 40 && cleanupModeFallback.includes('Standard cleanup'),
      `${fallbackText.length} chars`,
    );

    // S4 (UC05/UC13, A21): the model-cleanup opt-in. The model is re-cached
    // (the wrong-hash step purged it), the user toggles the model cleanup
    // on, picks a fixture, and the app either applies the VALIDATED model
    // cleanup (Chromium on this machine: the real wasm inference runs) or
    // says explicitly it could not (this Playwright WebKit build cannot
    // load the 397 MB weights — measured, docs/evidence/S4/
    // model_selection.md). Both are the designed behavior; raw model text
    // never shows either way.
    await clearModelCache(page);
    await page.goto(`http://127.0.0.1:${PORT}/?testModelUrl=http://127.0.0.1:4599/model`);
    await page.locator('#advanced-model summary').click(); // R2-3: opt-in section
    await page.locator('#model-download-btn').click();
    const modelReadyAgain = await page
      .locator('#model-ready')
      .waitFor({ timeout: 180000 })
      .then(() => true)
      .catch(() => false);
    step('the model re-downloads and is ready for the cleanup step', modelReadyAgain);
    const toggleThere = await page
      .locator('#llm-cleanup-toggle')
      .waitFor({ timeout: 10_000 })
      .then(() => true)
      .catch(() => false);
    step('the model-cleanup opt-in toggle is offered (default off)', toggleThere);
    const toggleDefaultOff = toggleThere ? await page.locator('#llm-cleanup-toggle').isChecked() : true;
    step('model cleanup is OFF by default (A19 decision)', toggleDefaultOff === false);
    if (toggleThere) {
      await page.locator('#llm-cleanup-toggle').check();
      await page.setInputFiles('#file-input', fixturePath('clean01'));
      let llmState = '';
      for (let i = 0; i < 300; i++) {
        llmState = (await page.locator('#llm-status').getAttribute('data-state').catch(() => '')) ?? '';
        if (llmState === 'applied' || llmState === 'unavailable') break;
        await sleep(1000);
      }
      const llmStatusText = await page.locator('#llm-status').textContent().catch(() => '');
      const llmText = await page.locator('#review-text').inputValue().catch(() => '');
      const suggestionsVisible = (await page.locator('#llm-suggestions').count()) > 0;
      step(
        `model cleanup settles into a designed state (state=${llmState})`,
        (llmState === 'applied' || llmState === 'unavailable') && llmText.length > 40,
        `state=${llmState} status="${llmStatusText?.trim()}" text=${llmText.length} chars suggestions=${suggestionsVisible}`,
      );
      if (llmState === 'applied') {
        // Suggestions exist but stay out of the payload until toggled on.
        const includeTags = (await page.locator('#llm-include-tags').count()) > 0
          ? await page.locator('#llm-include-tags').isChecked()
          : null;
        step(
          'suggestion payload toggles default off (plan point 5)',
          includeTags === null || includeTags === false,
          `includeTags=${includeTags}`,
        );
      }
    }

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
      // waitFor (not isVisible): the explanation renders asynchronously after
      // the real refused read — a bare isVisible() racy-lost this on CI's
      // slower runner (attempt 2) while the retrying e2e assert passes.
      const explained = await deniedPage
        .getByText('blocked for this site')
        .waitFor({ timeout: 10_000 })
        .then(() => true)
        .catch(() => false);
      // Diagnostics in the step detail: if the runner's clipboard ever
      // behaves differently, the log must say what actually happened.
      const deniedDiag = await deniedPage
        .evaluate(() => ({
          banner: document.querySelector('.error-banner')?.textContent?.slice(0, 120) ?? null,
          reviewVisible: !!document.querySelector('#review-text'),
          homeHeading: document.querySelector('h1')?.textContent ?? null,
        }))
        .catch(() => null);
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
        `explained=${explained} diag=${JSON.stringify(deniedDiag)}`,
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
  // The demo drives the model-manager steps through the test-only
  // ?testModelUrl / ?testProbe overrides, which are ABSENT from the production
  // build by design (A29). The demo therefore rebuilds the TEST build itself
  // before serving, whatever dist/ currently contains — CI's test.sh ends with
  // the production build, so the demo must be self-contained (this is the CI
  // failure root-cause of the first S5 PR head, fixed at the source).
  console.log('demo: building the test app (the demo needs the test-only model-server overrides)');
  execFileSync('npm', ['run', '--silent', 'build:test'], { cwd: ROOT, stdio: 'inherit' });
  // S3: the local model server serves the REAL pinned model file plus the
  // failure variants, so the demo exercises the real download path (the
  // built dist must be the test build — built above).
  const modelServer = spawn(
    process.execPath,
    [
      join('scripts', 'serve_model.mjs'),
      '--port',
      '4599',
      '--file',
      join('.cache/models', 'Qwen3-0.6B-Q4_K_M.gguf'),
      '--log',
      'artifacts/model-server.log',
    ],
    { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  modelServer.stdout.on('data', (d) => console.error(`[model-server] ${d.toString().trim()}`));
  modelServer.stderr.on('data', (d) => console.error(`[model-server] ${d.toString().trim()}`));
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
    await waitUp(`http://127.0.0.1:4599/healthz`);
    console.log(`demo: serving built app at http://127.0.0.1:${PORT}/`);
    const okChrome = await demoIn('chromium', chromium);
    const okWebkit = await demoIn('webkit', webkit);
    console.log(`demo: chromium=${okChrome ? 'PASS' : 'FAIL'} webkit=${okWebkit ? 'PASS' : 'FAIL'}`);
    process.exitCode = okChrome && okWebkit ? 0 : 1;
  } finally {
    preview.kill('SIGTERM');
    modelServer.kill('SIGTERM');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
