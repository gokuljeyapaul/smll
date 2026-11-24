import { test, expect } from '@playwright/test';
import { runPrivacyAudit, startCapture } from './helpers/privacy';
import { readFixtureB64 } from './helpers/pwa';

/**
 * UC03 (A09, chromium-only platform ID): pasting a screenshot processes it —
 * both channels the plan names:
 *   1. a real clipboard image (context grants clipboard-read/write in
 *      playwright.config.ts) read through the Paste button;
 *   2. a paste EVENT carrying an image file (Ctrl/Cmd+V path).
 * Playwright's WebKit grants no clipboard permissions, so the WebKit attempt
 * is recorded by scripts/probe_webkit_paste.mjs (docs/evidence/S2/), per the
 * plan's testability map. Nothing about the clipboard is faked inside the app.
 */
test.skip(
  ({ browserName }) => browserName !== 'chromium',
  'A09/UC03 is a chromium-only platform ID (plan testability map); the WebKit attempt is recorded by scripts/probe_webkit_paste.mjs',
);

test('uc03_paste_button_processes_clipboard_image', async ({ page }) => {
  const capture = startCapture(page);
  const bytes = await readFixtureB64('fixtures/images/clean01.png');
  await page.goto('/');

  // A REAL image goes onto the REAL clipboard (permission granted by the context).
  await page.evaluate(async (b64) => {
    const buf = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    await navigator.clipboard.write([
      new ClipboardItem({ 'image/png': new Blob([buf], { type: 'image/png' }) }),
    ]);
  }, bytes);

  await page.locator('#paste-btn').click();

  // The pasted screenshot is processed: real OCR, review screen with text.
  await expect(page.getByRole('heading', { name: 'Your text' })).toBeVisible({ timeout: 120_000 });
  await expect
    .poll(async () => (await page.locator('#review-text').inputValue()).length, {
      timeout: 120_000,
      message: 'real in-browser OCR to process the pasted clipboard image',
    })
    .toBeGreaterThan(40);
  const reviewText = await page.locator('#review-text').inputValue();
  expect(reviewText).not.toContain('Like Comment Share');

  // A15: no post text in any storage, URL, console output or network request.
  const audit = await runPrivacyAudit(page, capture, [reviewText]);
  expect(audit.violations, JSON.stringify(audit.violations, null, 2)).toEqual([]);
});

test('uc03_paste_event_processes_pasted_file', async ({ page }) => {
  const bytes = await readFixtureB64('fixtures/images/clean02.png');
  await page.goto('/');
  // The paste handler registers in a post-paint effect; wait for a rendered
  // frame so the flow measures paste behavior, not the app's startup race.
  await page.waitForSelector('#paste-btn');
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 50))),
  );

  // A text-only paste is NOT hijacked (normal textarea pasting keeps working).
  const textPastePrevented = await page.evaluate(() => {
    const dt = new DataTransfer();
    dt.items.add(new File(['plain text'], 'note.txt', { type: 'text/plain' }));
    const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
    document.dispatchEvent(ev);
    return ev.defaultPrevented;
  });
  expect(textPastePrevented).toBe(false);
  await expect(page.getByRole('heading', { name: 'PostClip' })).toBeVisible();

  // A pasted IMAGE file is routed into the pipeline and processed.
  await page.evaluate((b64) => {
    const buf = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const dt = new DataTransfer();
    dt.items.add(new File([buf], 'pasted.png', { type: 'image/png' }));
    document.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }),
    );
  }, bytes);

  await expect(page.getByRole('heading', { name: 'Your text' })).toBeVisible({ timeout: 120_000 });
  await expect
    .poll(async () => (await page.locator('#review-text').inputValue()).length, {
      timeout: 120_000,
      message: 'real in-browser OCR to process the pasted file',
    })
    .toBeGreaterThan(40);
});
