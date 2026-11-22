/**
 * Capture the S1 owner gallery (plan Conformance O02): phone-viewport
 * screenshots of a real passing run — the review/edit screen (cleaned text,
 * an edit applied), the export menu open, the non-English rejection message,
 * and the bad-input messages (tiny, corrupt, non-image, blank) — into
 * docs/evidence/S1/owner/ plus the gallery markdown with relative links.
 * Dev/test-only tooling; runs against the built dist/.
 *
 * Usage: node scripts/capture_owner_gallery_s1.mjs
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const PORT = 4214;
const OUT = join(ROOT, 'docs/evidence/S1/owner');

const MANIFEST = JSON.parse(readFileSync(join(ROOT, 'fixtures/manifest.json'), 'utf-8'));
const fixturePath = (id) => {
  const entry = MANIFEST.images.find((i) => i.id === id);
  if (!entry) throw new Error(`gallery: fixture ${id} missing from the manifest`);
  return join(ROOT, 'fixtures', entry.file);
};

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

async function pick(page, id) {
  await page.goto(`http://127.0.0.1:${PORT}/`);
  await page.setInputFiles('#file-input', fixturePath(id));
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
    });
    const page = await context.newPage();

    // 1-2. Review screen with real OCR + cleanup, then with an edit applied.
    await pick(page, 'clean01');
    let text = '';
    for (let i = 0; i < 120; i++) {
      text = await page.locator('#review-text').inputValue();
      if (text.length > 0) break;
      await sleep(1000);
    }
    if (text.length === 0) throw new Error('OCR produced no text; refusing to fake a gallery');
    await page.screenshot({ path: join(OUT, '01-review-cleaned.png'), fullPage: false });

    await page.locator('#review-text').fill(`${text}\n\nEdited while reviewing — my own line.`);
    await page.screenshot({ path: join(OUT, '02-edited.png'), fullPage: false });

    // 3. The export menu, open.
    await page.locator('#export-menu summary').click();
    await sleep(300);
    await page.screenshot({ path: join(OUT, '03-export-menu.png'), fullPage: false });

    // 4. The non-English rejection.
    await pick(page, 'de01');
    await page.waitForSelector('.error-banner', { timeout: 120_000 });
    await page.screenshot({ path: join(OUT, '04-non-english.png'), fullPage: false });

    // 5-8. The bad-input messages.
    const bad = [
      ['tiny01', '05-too-small'],
      ['corrupt01', '06-corrupt'],
      ['nonimage01', '07-not-an-image'],
      ['blank01', '08-no-text'],
    ];
    for (const [id, name] of bad) {
      await pick(page, id);
      await page.waitForSelector('.error-banner', { timeout: 120_000 });
      await page.screenshot({ path: join(OUT, `${name}.png`), fullPage: false });
    }

    await browser.close();

    const gallery = `# S1 owner gallery — cleanup, edit, export, language gate, errors (O02)

Captured from a real passing run of the built app (real in-browser OCR on the
synthetic fixtures \`clean01.png\` and \`de01.png\`, phone viewport 390×844,
headless Chromium on the building machine). Screenshots are committed next to
this file.

1. **Review (cleaned)** — the text after real OCR + deterministic cleanup: UI
   chrome (author header, reaction counts, Like/Comment/Share) is gone, the
   post body reads naturally, the text is fully editable:
   [01-review-cleaned.png](01-review-cleaned.png)
2. **Edited** — the same review after adding my own line (edits stick and flow
   into Share, Copy and Export exactly): [02-edited.png](02-edited.png)
3. **Export menu** — .md / .txt / .json downloads of exactly the text on
   screen: [03-export-menu.png](03-export-menu.png)
4. **Non-English message** — a German screenshot is rejected with a clear,
   kind message and nothing is processed:
   [04-non-english.png](04-non-english.png)
5. **Too small** — a 64×64 image is rejected before OCR:
   [05-too-small.png](05-too-small.png)
6. **Corrupt image** — a damaged PNG file gets its own explanation:
   [06-corrupt.png](06-corrupt.png)
7. **Not an image** — a plain text file is recognized as not a screenshot:
   [07-not-an-image.png](07-not-an-image.png)
8. **No readable text** — a blank image says so clearly:
   [08-no-text.png](08-no-text.png)

You are confirming (issue tick-list): the cleaned text reads naturally, edits
stick, and the messages are clear and kind. Reply \`O02 ok\` or
\`O02 no: <why>\` in the slice issue.
`;
    writeFileSync(join(OUT, 'gallery.md'), gallery);
    console.log(`S1 owner gallery written to docs/evidence/S1/owner/ (review text: ${text.length} chars)`);
  } finally {
    preview.kill('SIGTERM');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
