/**
 * WebKit paste attempt probe (S2, A09 — "WebKit clipboard-image support is
 * attempted and recorded", plan testability map). Runs against the built
 * dist/ and records, with real output, exactly what Playwright's WebKit
 * build on this machine can and cannot do for each paste channel — so the
 * A09 limitation is measured, not assumed:
 *
 *   1. navigator.clipboard.write with an image ClipboardItem (can the test
 *      even place a real image on the WebKit clipboard?),
 *   2. navigator.clipboard.read() (permission state),
 *   3. a dispatched ClipboardEvent('paste') carrying a File (does the
 *      event's clipboardData survive construction, and does the app's
 *      paste handler process it?),
 *   4. a real keyboard Ctrl/Cmd+V paste of TEXT (writeText needs no
 *      permission) to show the paste path itself works in WebKit.
 *
 * Usage: node scripts/probe_webkit_paste.mjs     (writes docs/evidence/S2/webkit-paste-probe.log)
 */
import { webkit, chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const PORT = 4199;
const OUT = join(ROOT, 'docs/evidence/S2/webkit-paste-probe.log');
const FIXTURE = join(ROOT, 'fixtures/images/clean01.png');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitUp() {
  await sleep(2000);
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/`);
      if (res.ok) return;
    } catch {
      // server not up yet — retry
    }
    await sleep(500);
  }
  throw new Error('probe: preview server did not start');
}

const lines = [];
const record = (name, ok, detail) => {
  lines.push(`${ok ? 'PASS' : 'BLOCKED'} — ${name}${detail ? ` :: ${detail}` : ''}`);
  console.log(lines.at(-1));
};

/** After a load, the React app's document-level paste listener registers in
 *  a post-paint effect — wait for a rendered frame before dispatching so the
 *  probe measures the app's paste behavior, not its startup race. */
async function waitForPasteHandlerReady(page) {
  await page.waitForSelector('#paste-btn, #file-input', { timeout: 30_000 });
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 50))),
  );
}

async function probe(browserType, engine, contextOptions = {}) {
  const browser = await browserType.launch();
  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();
  const url = `http://127.0.0.1:${PORT}/`;
  const bytesB64 = readFileSync(FIXTURE).toString('base64');

  // 1. Can an image be placed on this engine's clipboard via the API?
  try {
    await page.goto(url);
    await waitForPasteHandlerReady(page);
    await page.evaluate(async (b64) => {
      const buf = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      await navigator.clipboard.write([
        new ClipboardItem({ 'image/png': new Blob([buf], { type: 'image/png' }) }),
      ]);
    }, bytesB64);
    record(`${engine}: clipboard.write(image) API accepted`, true);
  } catch (err) {
    record(`${engine}: clipboard.write(image) API accepted`, false, String(err).slice(0, 200));
  }

  // 2. Can the clipboard be read back?
  try {
    const out = await page.evaluate(async () => {
      const items = await navigator.clipboard.read();
      return items.flatMap((i) => [...i.types]);
    });
    record(`${engine}: clipboard.read() returned types`, true, JSON.stringify(out));
  } catch (err) {
    record(`${engine}: clipboard.read() returned types`, false, String(err).slice(0, 200));
  }

  // 3. Does a dispatched paste event carry its clipboardData, and does the
  //    app process the pasted image file?
  try {
    await page.goto(url);
    await waitForPasteHandlerReady(page);
    await page.evaluate((b64) => {
      const buf = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const dt = new DataTransfer();
      dt.items.add(new File([buf], 'pasted.png', { type: 'image/png' }));
      const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
      document.dispatchEvent(ev);
      window.__pasteEvPrevented = ev.defaultPrevented;
      window.__pasteEvHadFiles = !!(ev.clipboardData && ev.clipboardData.files.length > 0);
    }, bytesB64);
    const carried = await page.evaluate(() => ({
      prevented: window.__pasteEvPrevented,
      hadFiles: window.__pasteEvHadFiles,
    }));
    record(`${engine}: ClipboardEvent('paste') carries clipboardData with the file`, carried.hadFiles, JSON.stringify(carried));
    let processed = false;
    for (let i = 0; i < 60 && !processed; i++) {
      processed = (await page.getByRole('heading', { name: 'Review' }).isVisible().catch(() => false));
      if (!processed) await sleep(1000);
    }
    record(`${engine}: dispatched paste event processed by the app (review screen)`, processed);
  } catch (err) {
    record(`${engine}: dispatched paste event processed by the app (review screen)`, false, String(err).slice(0, 200));
  }

  // 4. Real keyboard paste of TEXT (no permission needed anywhere).
  try {
    await page.goto(url);
    await waitForPasteHandlerReady(page);
    await page.evaluate(async () => {
      await navigator.clipboard.writeText('webkit-probe-text');
    });
    await page.evaluate(() => {
      const ta = document.createElement('textarea');
      ta.id = 'probe-target';
      document.body.appendChild(ta);
    });
    await page.locator('#probe-target').click();
    await page.keyboard.press('ControlOrMeta+V');
    const pasted = await page.locator('#probe-target').inputValue();
    record(`${engine}: real Ctrl/Cmd+V paste round-trip of writeText text`, pasted === 'webkit-probe-text', JSON.stringify(pasted));
  } catch (err) {
    record(`${engine}: real Ctrl/Cmd+V paste round-trip of writeText text`, false, String(err).slice(0, 200));
  }

  await context.close();
  await browser.close();
}

async function main() {
  mkdirSync(dirname(OUT), { recursive: true });
  const preview = spawn(
    process.execPath,
    ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--host', '127.0.0.1', '--strictPort'],
    { cwd: ROOT, stdio: ['ignore', 'ignore', 'pipe'] },
  );
  preview.stderr.on('data', (d) => process.stderr.write(`[preview] ${d}`));
  try {
    await waitUp();
    lines.push(`# WebKit paste attempt — recorded ${new Date().toISOString()} by scripts/probe_webkit_paste.mjs`);
    lines.push(`# Built app on http://127.0.0.1:${PORT}/ ; Playwright 1.65.1 webkit-2388 + chromium-1255 on this Linux container.`);
    lines.push('# A09 is a chromium-only platform ID; these lines record what WebKit can and cannot do here.');
    lines.push('');
    await probe(webkit, 'webkit');
    lines.push('');
    await probe(chromium, 'chromium (comparison)', { permissions: ['clipboard-read', 'clipboard-write'] });
  } finally {
    preview.kill();
  }
  const body = `${lines.join('\n')}\n`;
  const { writeFileSync } = await import('node:fs');
  writeFileSync(OUT, body);
  console.log(`\nprobe written: ${OUT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
