#!/usr/bin/env node
/**
 * Natural-pace FULL-WORKING demo capture — ROUND-2 edition (the owner's
 * post-round-2 re-record instruction; epic #80; the DV #73 asset re-recorded
 * on the round-2 app).
 *
 * ONE continuous real run of the real app at natural pace, driven like a
 * user, showing everything the ROUND-2 app does, in this order:
 *   1. paste a real screenshot in -> REAL in-browser OCR -> the share-first
 *      RESULT screen lands on "Your text" with the large Copy button FIRST;
 *   2. Copy (real clipboard write, read back and asserted), Share (the OS
 *      sheet is not capturable headless — the payload is spy-asserted),
 *      Save as file (real .md/.txt/.json downloads), a deliberate Edit, and
 *      the raw-OCR transparency view;
 *   3. the SAME result screen at the 390x844 phone viewport (the R2-2
 *      responsive layout, asserted live: Copy above the fold, no horizontal
 *      overflow), then back to desktop size;
 *   4. Start over -> the tidy-up model is OPT-IN: open the collapsed
 *      "Advanced: optional tidy-up model" section -> download ONCE with
 *      visible progress (the real 377 MiB pinned file served from the LOCAL
 *      cache by scripts/serve_model.mjs — never re-fetched from the
 *      network), sha256-verified before caching -> ready (cached);
 *   5. switch the model cleanup ON, pick the same screenshot again -> REAL
 *      on-device WASM inference (the only slow stage; time-compressed in
 *      post-production with the factor disclosed on screen) -> the guarded,
 *      verified result + suggestions;
 *   6. the EMBEDDABLE flow (R2-2): a host app on a SECOND origin
 *      (e2e/fixtures/host/host.html, served by an inline host server) embeds
 *      PostClip cross-origin, hands the screenshot over through the
 *      postMessage contract, and receives the real OCR text back — with the
 *      embedded instance showing the model READY (cached): downloaded once,
 *      shared by every instance on the origin.
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
import { createServer } from 'node:http';
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
// The app preview is served at 127.0.0.1 (vite spawned with an explicit IPv4
// host — vite's default localhost bind comes up IPv6-only (::1) in this
// container while node's fetch('http://localhost:4173') stays on IPv4; the
// R2-2 O08 gallery hit this). The HOST page keeps its localhost:4199 origin:
// 127.0.0.1 vs localhost stay DIFFERENT origins by design (the R2-2 e2e
// suite's allowed/stranger page pair).
const APP_PORT = 4173;
const APP_ORIGIN = `http://127.0.0.1:${APP_PORT}`;
const HOST_PORT = 4199;
const HOST_ORIGIN = `http://localhost:${HOST_PORT}`;
const FIXTURE = join(ROOT, 'fixtures', 'images', 'clean01.png');
const HOST_PAGE = join(ROOT, 'e2e', 'fixtures', 'host', 'host.html');
const MODEL_FILE = join(ROOT, '.cache', 'models', 'Qwen3-0.6B-Q4_K_M.gguf');
const PINNED_SHA256 = 'ac2d97712095a558e31573f62f466a3f9d93990898b0ec79d7c974c1780d524a';
const PINNED_BYTES = 396705472;
const PHONE_VP = { width: 390, height: 844 };

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
      process.kill(-c.pid, 'SIGTERM'); // the whole group (node -> vite, node -> serve_model)
    } catch {
      try {
        c.kill('SIGKILL');
      } catch {
        /* already gone */
      }
    }
  }
}

// Safety net: any exit path (including a precondition die() before the main
// try) must not leak the spawned servers — the ports are probed as free at
// the next run and a leftover would fail it loudly.
process.once('exit', killChildren);
let hostServer = null;

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

async function main() {
  mkdirSync(OUT, { recursive: true });
  mkdirSync(VIDEO_DIR, { recursive: true });
  writeFileSync(LOG_PATH, `full-demo (round-2) capture — ${new Date().toISOString()}\n`);

  // ---- Preconditions (all loud, none silently skipped) ----
  if (!existsSync(join(ROOT, 'dist', 'index.html'))) die('dist/index.html missing — run `npm run build:test` first');
  const distHtml = readFileSync(join(ROOT, 'dist', 'index.html'), 'utf-8');
  if (!distHtml.includes('127.0.0.1:4599')) {
    die('dist/ is not the TEST build (no local model server in CSP) — run `npm run build:test`');
  }
  if (!existsSync(FIXTURE)) die(`fixture missing: ${FIXTURE}`);
  if (!existsSync(HOST_PAGE)) die(`demo host page missing: ${HOST_PAGE}`);
  if (!existsSync(MODEL_FILE)) die(`pinned model file missing: ${MODEL_FILE} — run \`npm run fetch:model\``);
  writeLog(`verifying cached model sha256 (${PINNED_BYTES} bytes)...`);
  const modelSha = createHash('sha256').update(readFileSync(MODEL_FILE)).digest('hex');
  writeLog(`model sha256=${modelSha}`);
  if (modelSha !== PINNED_SHA256) die(`model sha256 mismatch: ${modelSha} != ${PINNED_SHA256}`);

  // ---- Servers ----
  // Fail loudly on leftovers: a stale preview would serve an old dist, a
  // stale model server would answer with the wrong file.
  for (const url of [`${APP_ORIGIN}/`, `${MODEL_SERVER}/healthz`, `${HOST_ORIGIN}/host.html`]) {
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
  writeLog('starting vite preview (direct, explicit IPv4 host) on the TEST dist/');
  spawnChild(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', String(APP_PORT), '--host', '127.0.0.1', '--strictPort'], { stdio: 'ignore' });
  await waitForUrl(`${APP_ORIGIN}/`, 45_000).catch((e) => die(String(e)));
  writeLog('starting the demo host server (second origin; the R2-2 e2e host page)');
  const hostHtml = readFileSync(HOST_PAGE, 'utf-8');
  const hostPng = readFileSync(FIXTURE);
  hostServer = createServer((req, res) => {
    const path = (req.url ?? '/').split('?')[0];
    if (path === '/host.html' || path === '/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(hostHtml);
    } else if (path === '/fixture.png') {
      res.writeHead(200, { 'content-type': 'image/png' });
      res.end(hostPng);
    } else {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('not found');
    }
  });
  hostServer.listen(HOST_PORT, '::');
  await waitForUrl(`${HOST_ORIGIN}/host.html`, 15_000).catch((e) => die(String(e)));
  writeLog(`app origin: ${APP_ORIGIN}; host origin: ${HOST_ORIGIN} (cross-origin by design)`);

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
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e)));

  try {
    // ============ Stage 1: home + paste a screenshot in ============
    await page.goto(`${APP_ORIGIN}/?testModelUrl=${MODEL_SERVER}/model-slow`);
    await page.locator('#app-title').waitFor({ timeout: 30_000 });
    writeLog('home screen loaded (test build; model URL -> local cached file)');
    // The tidy-up model is OPT-IN (R2-3 A40): the Advanced section exists,
    // is COLLAPSED, and nothing about the model is on the reading path. (The
    // download button exists in the DOM inside the collapsed section — the
    // honest check is that it is NOT VISIBLE.)
    const advanced = page.locator('#advanced-model');
    if ((await advanced.count()) !== 1) die('the Advanced opt-in section is missing on a fresh profile');
    if (await advanced.getAttribute('open')) die('the Advanced section is not collapsed on a fresh profile');
    if (await page.locator('#model-download-btn').isVisible()) {
      die('a download button is visible OUTSIDE the collapsed Advanced section (not opt-in)');
    }
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

    // ============ Stage 2: REAL in-browser OCR -> the share-first result screen ============
    await page.getByRole('heading', { name: 'Your text' }).waitFor({ timeout: 120_000 });
    mark('result_screen');
    let text = '';
    const ocrDeadline = Date.now() + 120_000;
    while (Date.now() < ocrDeadline) {
      text = await page.locator('#review-text').inputValue();
      if (text.length > 40) break;
      await sleep(300);
    }
    if (text.length <= 40) die(`OCR produced no text (len=${text.length})`);
    mark('ocr_done', { chars: text.length });
    writeLog(`real OCR done: ${text.length} chars — landed on "Your text", Copy first`);
    await sleep(1600);

    // ============ Stage 3: Copy / Share / Save as file / Edit (result-first order) ============
    const copyBtn = page.locator('#copy-btn');
    await copyBtn.scrollIntoViewIfNeeded();
    await sleep(600);
    mark('copy_click');
    await copyBtn.click();
    await page.locator('.copied-note').waitFor({ timeout: 15_000 });
    mark('copied_confirmed');
    const readBack = await page.evaluate(() => navigator.clipboard.readText());
    if (readBack !== text) die(`clipboard read-back does not match the result text (${readBack.length} vs ${text.length} chars)`);
    writeLog('copy confirmed: the real clipboard holds exactly the result text');
    await sleep(900);

    await page.locator('#share-btn').scrollIntoViewIfNeeded();
    await sleep(500);
    mark('share_click');
    await page.locator('#share-btn').click();
    await sleep(900);

    await page.locator('#export-menu summary').scrollIntoViewIfNeeded();
    await sleep(500);
    await page.locator('#export-menu summary').click();
    mark('export_menu_open');
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
    // The exports carry the result text: .md/.txt verbatim, .json under `text`.
    const savedMd = readFileSync(join(OUT, `export-${downloads[0].name}`), 'utf-8');
    const savedTxt = readFileSync(join(OUT, `export-${downloads[1].name}`), 'utf-8');
    const savedJson = readFileSync(join(OUT, `export-${downloads[2].name}`), 'utf-8');
    if (savedMd !== text || savedTxt !== text) die('the .md/.txt exports are not the result text verbatim');
    let jsonDoc = null;
    try {
      jsonDoc = JSON.parse(savedJson);
    } catch {
      die('the .json export does not parse');
    }
    if (!jsonDoc || jsonDoc.text !== text) die('the .json export does not carry the result text under `text`');
    mark('exports_done');

    // ============ Stage 4: a deliberate edit ============
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

    // Transparency: the raw pre-cleanup OCR is one disclosure away.
    await page.locator('.raw-ocr summary').scrollIntoViewIfNeeded();
    await sleep(500);
    await page.locator('.raw-ocr summary').click();
    mark('raw_ocr_shown');
    await sleep(1800);
    await page.locator('.raw-ocr summary').click();
    await sleep(400);

    // ============ Stage 5: the SAME result screen at 390x844 (responsive) ============
    mark('resp_start');
    await page.setViewportSize(PHONE_VP);
    await sleep(1400); // let the layout reflow be seen
    const box = await copyBtn.boundingBox();
    if (!box) die('Copy has no bounding box at 390x844');
    if (box.x < 0 || box.y < 0 || box.x + box.width > PHONE_VP.width + 1 || box.y + box.height > PHONE_VP.height + 1) {
      die(`Copy is not fully above the fold at 390x844 (box=${JSON.stringify(box)})`);
    }
    if (box.height < 44) die(`Copy touch target < 44px at 390x844 (${box.height}px)`);
    const overflow = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
    if (overflow.sw > overflow.iw + 1) die(`horizontal overflow at 390x844 (scrollWidth ${overflow.sw} > innerWidth ${overflow.iw})`);
    writeLog('responsive: Copy fully above the fold, >=44px target, no horizontal overflow at 390x844');
    await sleep(1200);
    // show the rest of the screen is fine too, then back up to the actions
    await review.scrollIntoViewIfNeeded();
    mark('resp_mid');
    await sleep(1500);
    await copyBtn.scrollIntoViewIfNeeded();
    await sleep(1200);
    mark('resp_end');
    await page.setViewportSize({ width: 1280, height: 720 });
    await sleep(900);

    // ============ Stage 6: start over -> the opt-in model download ============
    await page.getByRole('button', { name: 'Start over' }).scrollIntoViewIfNeeded();
    await sleep(400);
    mark('start_over_click');
    await page.getByRole('button', { name: 'Start over' }).click();
    await page.locator('#app-title').waitFor({ timeout: 15_000 });
    mark('back_home');
    await sleep(1000);

    const advancedSummary = page.locator('#advanced-model summary');
    await advancedSummary.scrollIntoViewIfNeeded();
    await sleep(700);
    mark('advanced_open');
    await advancedSummary.click();
    await page.locator('#model-download-btn').waitFor({ timeout: 10_000 });
    writeLog('Advanced section open: the tidy-up model download is opt-in, one click deep');
    await sleep(1500); // let the viewer read the offer
    mark('model_download_click');
    await page.locator('#model-download-btn').click();
    // Real paced download of the 377 MiB pinned file from the local server
    // (which reads the CACHED file), then streamed sha256 verify, then ready.
    await page.locator('#model-progress').waitFor({ timeout: 30_000 });
    mark('model_progress_visible');
    // Watch the progress bar actually move (real bytes on the wire). The
    // loop ends when the bar fills OR the ready line appears — whichever
    // comes first (it must never outlive the download).
    const progressDeadline = Date.now() + 300_000;
    let pct = -1;
    let logged25 = false;
    let logged50 = false;
    let logged75 = false;
    while (Date.now() < progressDeadline) {
      if ((await page.locator('#model-ready').count()) > 0) break;
      const now = parseInt((await page.locator('#model-progress').getAttribute('aria-valuenow')) ?? '-1', 10);
      if (now > pct) {
        pct = now;
        if (!logged25 && pct >= 25) { logged25 = true; mark('model_progress_25', { pct }); }
        if (!logged50 && pct >= 50) { logged50 = true; mark('model_progress_50', { pct }); }
        if (!logged75 && pct >= 75) { logged75 = true; mark('model_progress_75', { pct }); }
      }
      if (pct >= 100) break;
      await sleep(400);
    }
    await page.locator('#model-ready').waitFor({ timeout: 300_000 });
    mark('model_ready');
    writeLog('model downloaded (real bytes over HTTP), sha256-verified and cached — #model-ready visible');
    await sleep(1200);

    // ============ Stage 7: opt in to the model cleanup, pick again ============
    const homeToggle = page.locator('#llm-cleanup-toggle');
    await homeToggle.scrollIntoViewIfNeeded();
    await sleep(700);
    mark('llm_toggle_click');
    await homeToggle.check();
    await sleep(900);
    if (!(await homeToggle.isChecked())) die('the model cleanup toggle did not stay checked');

    await page.getByRole('button', { name: 'Choose screenshot' }).scrollIntoViewIfNeeded();
    await sleep(600);
    mark('pick_click');
    const chooserPromise = page.waitForEvent('filechooser', { timeout: 15_000 });
    await page.getByRole('button', { name: 'Choose screenshot' }).click();
    const chooser = await chooserPromise;
    await chooser.setFiles(FIXTURE);
    writeLog('same screenshot picked again, model cleanup now ON');

    await page.getByRole('heading', { name: 'Your text' }).waitFor({ timeout: 120_000 });
    // Deterministic text shows first, then the model upgrade.
    const detDeadline = Date.now() + 120_000;
    while (Date.now() < detDeadline) {
      const v = await page.locator('#review-text').inputValue();
      if (v.length > 40) break;
      await sleep(300);
    }
    mark('ocr2_deterministic_visible');

    // ============ Stage 8: REAL WASM inference (the slow stage) ============
    let sawRunning = false;
    let runStartAt = null;
    let state = '';
    const inferenceDeadline = Date.now() + 360_000;
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

    // Share payload assertion (the spy recorded it during stage 3 — BEFORE
    // the deliberate edit, which is the R2-1 result-screen order: actions
    // first, the editable text after them).
    const shareCalls = await page.evaluate(() => window.__shareCalls);
    if (shareCalls.length !== 1) die(`expected exactly 1 share call, saw ${shareCalls.length}`);
    if (shareCalls[0].text !== text) die('share payload text does not match the result text shown when Share was clicked');
    writeLog('share payload = the result text on screen at the click (spy-asserted)');

    // ============ Stage 9: embeddable — a host app on a second origin ============
    mark('host_segment_start');
    const hostUrl = `${HOST_ORIGIN}/host.html?app=${encodeURIComponent(APP_ORIGIN)}&allow=${encodeURIComponent(HOST_ORIGIN)}&frameallow=${encodeURIComponent('clipboard-write')}`;
    await page.goto(hostUrl);
    await page.locator('#send-btn').waitFor({ timeout: 30_000 });
    mark('host_page_loaded');
    writeLog('demo host page loaded (cross-origin: the host app embeds PostClip below)');
    const app = page.frameLocator('#postclip-frame');
    await app.getByRole('button', { name: 'Choose screenshot' }).waitFor({ timeout: 60_000 });
    mark('host_frame_home');
    // The embedded instance sees the model READY (cached): downloaded once,
    // shared across instances on the origin — the R2-3 promise, live.
    await app.locator('#model-ready').waitFor({ timeout: 30_000 });
    writeLog('the embedded instance shows "Tidy-up model ready (cached)" — downloaded once, no re-download');
    await sleep(1800);

    await page.locator('#send-btn').scrollIntoViewIfNeeded();
    await sleep(600);
    mark('host_send_click');
    await page.locator('#send-btn').click();
    // PostClip -> host: the result comes back (real OCR ran inside the frame).
    const resultText = page.locator('#result-text');
    await resultText.waitFor({ state: 'visible', timeout: 240_000 });
    const hostDeadline = Date.now() + 60_000;
    let hostResult = '';
    while (Date.now() < hostDeadline) {
      hostResult = (await resultText.textContent()) ?? '';
      if (hostResult.length > 40) break;
      await sleep(300);
    }
    if (hostResult.length <= 40) die(`the host round-trip result text is not real OCR output (len=${hostResult.length})`);
    mark('host_result', { chars: hostResult.length });
    // The boot announcement and the reply both came from the app's origin.
    const readyLi = page.locator('#host-log li[data-type="postclip:ready"]');
    if (!(await readyLi.count())) die('the host log has no postclip:ready entry');
    if ((await readyLi.first().getAttribute('data-origin')) !== APP_ORIGIN) die('postclip:ready came from a wrong origin');
    const replies = page.locator('#host-log li');
    const count = await replies.count();
    if (count < 2) die(`the host received fewer than 2 messages (${count})`);
    for (let i = 0; i < count; i++) {
      if ((await replies.nth(i).getAttribute('data-origin')) !== APP_ORIGIN) die('a host log entry came from a wrong origin');
    }
    if (page.url() !== hostUrl) die('the host page URL changed during the round trip');
    writeLog(`cross-origin round trip: host sent the screenshot, got ${hostResult.length} chars back (origin-checked, allow-listed)`);
    await resultText.scrollIntoViewIfNeeded();
    mark('final_hold_start');
    await sleep(4200);
    mark('final_hold_end');

    if (pageErrors.length) die(`page errors during the run: ${pageErrors.join(' | ')}`);
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
        run_shape: 'round-2: share-first result screen, responsive 390x844 segment, opt-in Advanced model download, model cleanup, cross-origin embedded round trip',
      };
      writeFileSync(join(OUT, 'markers.json'), JSON.stringify(summary, null, 2) + '\n');
      writeLog('markers.json written');
    } catch (teardownErr) {
      writeLog(`teardown error: ${String(teardownErr)}`);
    }
    await browser.close().catch(() => {});
    if (hostServer) hostServer.close();
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
