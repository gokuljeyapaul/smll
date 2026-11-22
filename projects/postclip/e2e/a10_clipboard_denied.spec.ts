import { test, expect } from '@playwright/test';
import { runPrivacyAudit, startCapture } from './helpers/privacy';

/**
 * UC12 (A10, chromium-only platform ID): with clipboard-read DENIED, the
 * Paste button shows an explanation naming the working alternative, and the
 * file picker still works. The context-level clipboard grants from
 * playwright.config.ts are overridden away for this spec, so the real
 * navigator.clipboard.read() is refused by the browser — nothing is faked
 * inside the app.
 */
test.skip(
  ({ browserName }) => browserName !== 'chromium',
  'A10/UC12 is a chromium-only platform ID (plan testability map): Playwright WebKit grants no clipboard permissions at all, so denial is its permanent state, recorded in the S1 limitations',
);

test.use({ permissions: [] }); // revoke the chromium project's clipboard grants

test('a10_denied_paste_explains_and_picker_works', async ({ page }) => {
  const capture = startCapture(page);
  await page.goto('/');

  // The Paste button is offered; clicking it triggers a REAL (refused) read.
  await page.locator('#paste-btn').click();

  // UC12: the explanation appears, says the clipboard is blocked, and points
  // at the file picker that still works.
  const alert = page.getByRole('alert');
  await expect(alert).toBeVisible();
  await expect(alert).toContainText('blocked for this site');
  await expect(alert).toContainText('Choose screenshot');

  // …and the file picker still works: a pick runs the full pipeline.
  await page.setInputFiles('#file-input', 'fixtures/images/clean01.png');
  await expect(page.getByRole('heading', { name: 'Review' })).toBeVisible({ timeout: 120_000 });
  await expect
    .poll(async () => (await page.locator('#review-text').inputValue()).length, {
      timeout: 120_000,
      message: 'real in-browser OCR to process the picked file after the denied paste',
    })
    .toBeGreaterThan(40);
  const reviewText = await page.locator('#review-text').inputValue();

  // A15: the denied state stored nothing and leaked nothing.
  const audit = await runPrivacyAudit(page, capture, [reviewText]);
  expect(audit.violations, JSON.stringify(audit.violations, null, 2)).toEqual([]);
});
