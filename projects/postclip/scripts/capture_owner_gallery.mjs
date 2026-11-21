/**
 * Capture the S0 owner gallery (plan Conformance O01): phone-viewport
 * screenshots of a real passing run — pick, review with real OCR text, and
 * the copied state — into docs/evidence/S0/owner/, plus the gallery markdown
 * with relative links. Dev/test-only tooling; runs against the built dist/.
 *
 * Usage: node scripts/capture_owner_gallery.mjs
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const PORT = 4213;
const OUT = join(ROOT, 'docs/evidence/S0/owner');
const FIXTURE = 'fixtures/images/clean01.png';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitUp() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/`);
      if (res.ok) return;
    } catch {
      /* server not up yet — keep polling */
    }
    await sleep(500);
  }
  throw new Error('preview server did not start');
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const preview = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--host', '127.0.0.1', '--strictPort'], {
    cwd: ROOT,
    stdio: 'ignore',
  });
  try {
    await waitUp();
    const browser = await chromium.launch();
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
      permissions: ['clipboard-read', 'clipboard-write'],
    });
    const page = await context.newPage();

    await page.goto(`http://127.0.0.1:${PORT}/`);
    await page.screenshot({ path: join(OUT, '01-pick.png'), fullPage: false });

    await page.setInputFiles('#file-input', join(ROOT, FIXTURE));
    let text = '';
    for (let i = 0; i < 120; i++) {
      text = await page.locator('#review-text').inputValue();
      if (text.length > 0) break;
      await sleep(1000);
    }
    if (text.length === 0) throw new Error('OCR produced no text; refusing to fake a gallery');
    await page.screenshot({ path: join(OUT, '02-review-ocr.png'), fullPage: false });

    await page.locator('#copy-btn').click();
    await page.waitForSelector('text=Copied', { timeout: 10_000 });
    await page.screenshot({ path: join(OUT, '03-copied.png'), fullPage: false });

    await browser.close();

    const gallery = `# S0 owner gallery — pick a screenshot, read it, review, share or copy (O01)

Captured from a real passing run of the built app (real in-browser OCR on the
synthetic fixture \`clean01.png\`, phone viewport 390×844, headless Chromium on
the building machine). Screenshots are committed next to this file.

1. **Pick** — the home screen with the drop zone and file picker:
   [01-pick.png](01-pick.png)
2. **Read + review** — the review screen showing the extracted text right after
   real in-browser OCR: [02-review-ocr.png](02-review-ocr.png)
3. **Copy** — after pressing Copy, with the confirmation:
   [03-copied.png](03-copied.png)

You are confirming (issue tick-list): the fixture's text appears on the review
screen legible and faithful, Copy works with feedback, and nothing looks
broken. Reply \`O01 ok\` or \`O01 no: <why>\` in the slice issue.
`;
    const { writeFileSync } = await import('node:fs');
    writeFileSync(join(OUT, 'gallery.md'), gallery);
    console.log(`owner gallery written to docs/evidence/S0/owner/ (review text: ${text.length} chars)`);
  } finally {
    preview.kill('SIGTERM');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
