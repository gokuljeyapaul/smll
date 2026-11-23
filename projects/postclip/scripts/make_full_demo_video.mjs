#!/usr/bin/env node
/**
 * Natural-pace FULL-WORKING demo capture (issue #73, post-DV demo asset).
 *
 * ONE continuous real run of the real app, driven like a user at natural
 * pace (deliberate pauses, scroll-to-visible before acting): paste a
 * screenshot in -> REAL in-browser OCR -> review/edit -> copy / share /
 * export -> REAL model download from the local server (which serves the
 * CACHED pinned file — never re-downloaded from the network) with visible
 * progress -> toggle the model cleanup ON -> REAL WASM inference -> the
 * guarded, verified result.
 *
 * NO fakes anywhere: the only test hook used is the test-build-only
 * ?testModelUrl= flag (the same one every e2e model flow uses) so the
 * download hits scripts/serve_model.mjs serving the already-cached pinned
 * file; navigator.share is SPIED (recorded, never rendered — the OS share
 * sheet is not capturable headless), which AGENTS.md sanctions. The video
 * this produces is a recording of a PASSING run: every stage below asserts
 * its real outcome and the driver exits non-zero on any failure.
 *
 * Output: artifacts/dv/postclip-full-run.webm (Playwright screencast),
 * artifacts/dv/markers.json (wall-clock stage markers for post-production)
 * and artifacts/dv/capture.log (the committed evidence log). The slow LLM
 * inference wait is NOT compressed here — compression happens in
 * scripts/compress_full_demo.mjs with a disclosed on-screen factor.
 *
 * Usage: PLAYWRIGHT_BROWSERS_PATH=... node scripts/make_full_demo_video.mjs
 * (requires `npm run build:test` to have produced the TEST dist/ first)
 */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync, copyFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const OUT = join(ROOT, 'artifacts', 'dv');
const VIDEO_DIR = join(OUT, 'video');
const LOG_PATH = join(OUT, 'capture.log');
const MODEL_PORT = 4599;
const MODEL_SERVER = `http://127.0.0.1:${MODEL_PORT}`;
const APP_PORT = 4173;
const FIXTURE = join(ROOT, 'fixtures', 'images', 'clean01.png');
const MODEL_FILE = join(ROOT, '.cache', 'models', 'Qwen3-0.6B-Q4_K_M.gguf');
const PINNED_SHA256 = 'ac2d97712095a558e31573f62f466a3f9d93990898b0ec79d7c974c1780d524a';
const PINNED_BYTES = 396705472;

const logLines = [];

function writeLog(text) {
  const line = `${new Date().toISOString()} ${text}`;
  console.log(`[full-demo] ${text}`);
  logLines.push(line);
  mkdirSync(OUT, { recursive: true });
  appendFileSync(LOG_PATH, line + '\n');
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const markers = [];
let t0 = 0;
function mark(name, extra = {}) {
  const t = (Date.now() - t0) / 1000;
  markers.push({ name, t, ...extra });
  writeLog(`marker ${name} @ ${t.toFixed(1)}s`);
}

function die(msg) {
  writeLog(`FATAL: ${msg}`);
  process.exitCode = 1;
  throw new Error(msg);
}

/** Start a child in its own process group; the whole group is killed at the end. */
const children = [];
function spawnChild(cmd, args, opts = {}) {
  const child = spawn(cmd, args, { cwd: ROOT, stdio: 'inherit', detached: true, ...opts });
  children.push(child);
  return child;
}

function killChildren() {
  for (const c of children) {
    try {
      process.kill(-c.pid, 'SIGTERM'); // the whole group (npm -> vite, node -> serve_model)
    } catch {
      try {
        c.kill('SIGTERM');
      } catch {
        /* already gone */
      }
    }
  }
}

async function waitForUrl(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastErr = 'unknown';
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return true;
      lastErr = `HTTP ${res.status}`;
    } catch (err) {
      lastErr = String(err);
    }
    await sleep(250);
  }
  throw new Error(`server not up at ${url} (${lastErr})`);
}

async function pickAppOrigin() {
  // vite preview binds IPv6 ::1 on this host; probe all three spellings with
  // real patience (npm->vite cold start can take ~10s on this machine).
  const candidates = [`http://[::1]:${APP_PORT}/`, `http://127.0.0.1:${APP_PORT}/`, `http://localhost:${APP_PORT}/`];
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    for (const url of candidates) {
      try {
        const res = await fetch(url);
        if (res.ok) return url;
      } catch {
        /* not up yet */
      }
    }
    await sleep(500);
  }
  return die(`no app origin answers on :${APP_PORT} (tried ${candidates.join(', ')})`);
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  mkdirSync(VIDEO_DIR, { recursive: true });
  writeFileSync(LOG_PATH, `full-demo capture — ${new Date().toISOString()}\n`);

  // ---- Preconditions (all loud, none silently skipped) ----
  if (!existsSync(join(ROOT, 'dist', 'index.html'))) die('dist/index.html missing — run `npm run build:test` first');
  const distHtml = readFileSync(join(ROOT, 'dist', 'index.html'), 'utf-8');
  if (!distHtml.includes('127.0.0.1:4599')) {
    die('dist/ is not the TEST build (no local model server in CSP) — run `npm run build:test`');
  }
  if (!existsSync(FIXTURE)) die(`fixture missing: ${FIXTURE}`);
  if (!existsSync(MODEL_FILE)) die(`pinned model file missing: ${MODEL_FILE} — run \`npm run fetch:model\``);
  writeLog(`verifying cached model sha256 (${PINNED_BYTES} bytes)...`);
  const modelSha = createHash('sha256').update(readFileSync(MODEL_FILE)).digest('hex');
  writeLog(`model sha256=${modelSha}`);
  if (modelSha !== PINNED_SHA256) die(`model sha256 mismatch: ${modelSha} != ${PINNED_SHA256}`);

  // ---- Servers ----
  // Fail loudly on leftovers: a stale vite preview would serve an old dist.
  for (const url of [`http://[::1]:${APP_PORT}/`, `http://127.0.0.1:${APP_PORT}/`, `http://localhost:${APP_PORT}/`]) {
    try {
      await fetch(url);
      die(`something already answers at ${url} — kill the leftover server first`);
    } catch {
      /* port free — good */
    }
  }
  writeLog('starting model server (serves the CACHED pinned file; /model-slow paces the download)');
  spawnChild(process.execPath, ['scripts/serve_model.mjs', '--port', String(MODEL_PORT), '--file', MODEL_FILE, '--log', join(OUT, 'model-server.log')]);
  await waitForUrl(`${MODEL_SERVER}/healthz`, 30_000).catch((e) => die(String(e)));
  writeLog('starting vite preview on the TEST dist/');
  spawnChild('npm', ['run', 'preview']);
  const appOrigin = await pickAppOrigin();
  writeLog(`app origin: ${appOrigin}`);

  // ---- Browser ----
  writeLog('launching chromium (headless, 1280x720, video on)');
  const browser = await chromium.launch();
  t0 = Date.now();
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    permissions: ['clipboard-read', 'clipboard-write'],
    acceptDownloads: true,
    recordVideo: { dir: VIDEO_DIR, size: { width: 1280, height: 720 } },
  });
  // Spy navigator.share: the OS share sheet cannot open headless; the spy
  // records the exact payload (asserted at the end) — AGENTS.md-sanctioned.
  await context.addInitScript(() => {
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
  const page = await context.newPage();

  try {
    // ============ Stage 1: home + paste a screenshot in ============
    await page.goto(`${appOrigin}?testModelUrl=${MODEL_SERVER}/model-slow`);
    await page.locator('#app-title').waitFor({ timeout: 30_000 });
    writeLog('home screen loaded (test build; model URL -> local cached file)');
    mark('home_loaded');
    await sleep(2200); // let the viewer read the home screen

    // A REAL image goes onto the REAL clipboard, then the Paste button reads it.
    const fixtureB64 = readFileSync(FIXTURE).toString('base64');
    await page.evaluate(async (b64) => {
      const buf = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      await navigator.clipboard.write([
        new ClipboardItem({ 'image/png': new Blob([buf], { type: 'image/png' }) }),
      ]);
    }, fixtureB64);
    writeLog('real PNG written to the real clipboard');
    await page.locator('#paste-btn').scrollIntoViewIfNeeded();
    await sleep(900);
    mark('paste_click');
    await page.locator('#paste-btn').click();

    // ============ Stage 2: REAL in-browser OCR -> review ============
    await page.getByRole('heading', { name: 'Review' }).waitFor({ timeout: 120_000 });
    mark('ocr_review_visible');
    await sleep(600);
    await page
      .locator('#review-text')
      .waitFor({ state: 'visible', timeout: 60_000 });
    let text = '';
    const ocrDeadline = Date.now() + 120_000;
    while (Date.now() < ocrDeadline) {
      text = await page.locator('#review-text').inputValue();
      if (text.length > 40) break;
      await sleep(300);
    }
    if (text.length <= 40) die(`OCR produced no text (len=${text.length})`);
    mark('ocr_done', { chars: text.length });
    writeLog(`real OCR done: ${text.length} chars cleaned text`);
    await sleep(1200);

    // Show the raw OCR (before cleanup) for transparency, then close it.
    await page.locator('.raw-ocr summary').scrollIntoViewIfNeeded();
    await sleep(500);
    await page.locator('.raw-ocr summary').click();
    mark('raw_ocr_shown');
    await sleep(1800);
    await page.locator('.raw-ocr summary').click();
    await sleep(400);

    // ============ Stage 3: review + deliberate edit ============
    const review = page.locator('#review-text');
    await review.scrollIntoViewIfNeeded();
    await sleep(700);
    await review.click();
    await page.keyboard.press('Control+End');
    await page.keyboard.press('End');
    await sleep(500);
    mark('edit_start');
    await page.keyboard.press('Enter');
    await page.keyboard.type('Cleaned and edited on-device by PostClip.', { delay: 65 });
    mark('edit_done');
    await sleep(1100);
    const editedText = await review.inputValue();
    if (!editedText.includes('edited on-device by PostClip')) die('the deliberate edit did not land in the review text');
    writeLog(`edited review text: ${editedText.length} chars`);

    // ============ Stage 4: copy / share / export ============
    await page.locator('#copy-btn').scrollIntoViewIfNeeded();
    await sleep(600);
    mark('copy_click');
    await page.locator('#copy-btn').click();
    await page.locator('.copied-note').waitFor({ timeout: 15_000 });
    mark('copied_confirmed');
    writeLog('copy confirmed by the UI (real clipboard write)');
    await sleep(900);

    await page.locator('#share-btn').scrollIntoViewIfNeeded();
    await sleep(500);
    mark('share_click');
    await page.locator('#share-btn').click();
    await sleep(900);

    await page.locator('#export-menu summary').scrollIntoViewIfNeeded();
    await sleep(500);
    await page.locator('#export-menu summary').click();
    await sleep(700);
    const downloads = [];
    for (const id of ['export-md', 'export-txt', 'export-json']) {
      mark(`${id}_click`);
      const dlPromise = page.waitForEvent('download', { timeout: 30_000 });
      await page.locator(`#${id}`).click();
      const dl = await dlPromise;
      const name = dl.suggestedFilename();
      const target = join(OUT, `export-${name}`);
      await dl.saveAs(target);
      downloads.push({ id, name, bytes: statSync(target).size });
      writeLog(`export ${id} -> ${name} (${statSync(target).size} bytes, real browser download)`);
      await sleep(700);
    }
    if (!downloads[0].name.endsWith('.md') || !downloads[1].name.endsWith('.txt') || !downloads[2].name.endsWith('.json')) {
      die(`unexpected export filenames: ${JSON.stringify(downloads)}`);
    }
    mark('exports_done');

    // ============ Stage 5: start over -> REAL model download ============
    await sleep(800);
    await page.getByRole('button', { name: 'Start over' }).scrollIntoViewIfNeeded();
    await sleep(400);
    mark('start_over_click');
    await page.getByRole('button', { name: 'Start over' }).click();
    await page.locator('#app-title').waitFor({ timeout: 15_000 });
    mark('back_home');
    await sleep(1000);

    await page.locator('#model-download-btn').scrollIntoViewIfNeeded();
    await sleep(1100);
    mark('model_download_click');
    await page.locator('#model-download-btn').click();
    // Real paced download of the 377 MiB pinned file from the local server
    // (which reads the CACHED file), then streamed sha256 verify, then ready.
    await page.locator('#model-ready').waitFor({ timeout: 300_000 });
    mark('model_ready');
    writeLog('model downloaded (real bytes over HTTP), sha256-verified and cached — #model-ready visible');
    await sleep(1200);

    // ============ Stage 6: toggle model cleanup ON, pick again ============
    await page.locator('#llm-cleanup-toggle').scrollIntoViewIfNeeded();
    await sleep(700);
    mark('llm_toggle_click');
    await page.locator('#llm-cleanup-toggle').check();
    await sleep(900);

    await page.getByRole('button', { name: 'Choose screenshot' }).scrollIntoViewIfNeeded();
    await sleep(600);
    mark('pick_click');
    const chooserPromise = page.waitForEvent('filechooser', { timeout: 15_000 });
    await page.getByRole('button', { name: 'Choose screenshot' }).click();
    const chooser = await chooserPromise;
    await chooser.setFiles(FIXTURE);
    writeLog('same screenshot picked again, model cleanup now ON');

    await page.getByRole('heading', { name: 'Review' }).waitFor({ timeout: 120_000 });
    // Deterministic text shows first, then the model upgrade.
    const detDeadline = Date.now() + 120_000;
    while (Date.now() < detDeadline) {
      const v = await page.locator('#review-text').inputValue();
      if (v.length > 40) break;
      await sleep(300);
    }
    mark('ocr2_deterministic_visible');

    // ============ Stage 7: REAL WASM inference (the slow stage) ============
    let sawRunning = false;
    let runStartAt = null;
    let state = '';
    const inferenceDeadline = Date.now() + 300_000;
    while (Date.now() < inferenceDeadline) {
      state = (await page.locator('#llm-status').getAttribute('data-state')) ?? '';
      if (!sawRunning && state === 'running') {
        sawRunning = true;
        runStartAt = Date.now();
        mark('llm_running');
        writeLog('model cleanup running (real wllama WASM inference started)');
      }
      if (state === 'applied' || state === 'unavailable') break;
      await sleep(500);
    }
    if (state !== 'applied') {
      die(`model cleanup did not apply (final state=${state}; sawRunning=${sawRunning})`);
    }
    // Give the UI a beat to swap in the model text, then mark the end.
    await sleep(1500);
    mark('llm_applied', { real_inference_s: runStartAt ? (Date.now() - runStartAt) / 1000 : null });
    writeLog(`model cleanup applied after a real inference of ${runStartAt ? ((Date.now() - runStartAt) / 1000).toFixed(1) : '?'}s`);

    // The review text IS the validated model output (guard passed).
    const finalText = await page.locator('#review-text').inputValue();
    const debug = await page.evaluate(() => window.__postclipLlmDebug);
    if (!debug || finalText !== debug.modelText) {
      die('review text is not the validated model output (guard/text mismatch)');
    }
    writeLog(`final review text = validated model output (${finalText.length} chars)`);

    // Show the verified suggestions + what the model removed.
    const suggestions = page.locator('#llm-suggestions');
    if ((await suggestions.count()) > 0) {
      await suggestions.scrollIntoViewIfNeeded();
      mark('suggestions_visible');
      await sleep(2200);
      const removed = page.locator('#llm-removed-chrome');
      if ((await removed.count()) > 0) {
        await removed.locator('summary').click();
        mark('removed_chrome_open');
        await sleep(1600);
      }
    }
    await page.locator('#review-text').scrollIntoViewIfNeeded();
    mark('final_hold_start');
    await sleep(4200);
    mark('final_hold_end');

    // Share payload assertion (the spy recorded it during stage 4).
    const shareCalls = await page.evaluate(() => window.__shareCalls);
    if (shareCalls.length !== 1) die(`expected exactly 1 share call, saw ${shareCalls.length}`);
    if (shareCalls[0].text !== editedText) die('share payload text does not match the edited review text');
    writeLog('share payload = the edited review text (spy-asserted)');
  } finally {
    // ---- Teardown: close everything so the video flushes ----
    try {
      const video = page.video();
      await context.close();
      const rawPath = await video.path();
      const finalVideo = join(OUT, 'postclip-full-run.webm');
      copyFileSync(rawPath, finalVideo);
      writeLog(`video saved: ${finalVideo} (${statSync(finalVideo).size} bytes)`);
      const summary = {
        video: 'artifacts/dv/postclip-full-run.webm',
        size_bytes: statSync(finalVideo).size,
        sha256: createHash('sha256').update(readFileSync(finalVideo)).digest('hex'),
        markers,
        captured_at: new Date().toISOString(),
        fixture: 'fixtures/images/clean01.png',
        model: { file: MODEL_FILE, sha256: modelSha, bytes: PINNED_BYTES, served_from: 'local cache via scripts/serve_model.mjs /model-slow' },
      };
      writeFileSync(join(OUT, 'markers.json'), JSON.stringify(summary, null, 2) + '\n');
      writeLog('markers.json written');
    } catch (teardownErr) {
      writeLog(`teardown error: ${String(teardownErr)}`);
    }
    await browser.close().catch(() => {});
    killChildren();
  }
}

main().then(
  () => {
    writeLog('CAPTURE OK');
    process.exit(0);
  },
  (err) => {
    writeLog(`CAPTURE FAILED: ${err && err.stack ? err.stack : String(err)}`);
    process.exit(1);
  },
);
