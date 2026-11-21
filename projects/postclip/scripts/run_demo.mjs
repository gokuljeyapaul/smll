/**
 * Demo (S0): build the app, serve the built dist/, and run the end-to-end demo
 * flow in real Chromium and WebKit — pick a fixture, real in-browser OCR,
 * review text, Web Share payload (spied), Copy, paste round-trip. Prints
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
const FIXTURE = 'fixtures/images/clean01.png';

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

async function demoIn(engineName, browserType) {
  const browser = await browserType.launch();
  // Chromium needs explicit clipboard permissions (as in playwright.config.ts);
  // Playwright WebKit supports no clipboard permissions at all — it needs none.
  const context = await browser.newContext(
    engineName === 'chromium' ? { permissions: ['clipboard-read', 'clipboard-write'] } : {},
  );
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

    await page.setInputFiles('#file-input', join(ROOT, FIXTURE));
    let text = '';
    for (let i = 0; i < 120; i++) {
      text = await page.locator('#review-text').inputValue();
      if (text.length > 0) break;
      await sleep(1000);
    }
    step('real OCR produces review text', text.length > 40, `${text.length} chars`);
    const gold = JSON.parse(readFileSync(join(ROOT, 'fixtures/gold/clean01.json'), 'utf-8'));
    const firstGoldLine = gold.ocr_expected[0] ?? '';
    step(
      'review text matches the fixture (first gold line found)',
      text.includes(firstGoldLine),
      `'${firstGoldLine}'`,
    );

    await page.locator('#share-btn').click();
    const shareCalls = await page.evaluate(() => window.__shareCalls);
    step(
      'Web Share payload equals review text',
      shareCalls.length === 1 && shareCalls[0].text === text,
    );

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
    step('clipboard paste round-trip delivers the review text', pasted === text, `${pasted.length} chars`);
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
