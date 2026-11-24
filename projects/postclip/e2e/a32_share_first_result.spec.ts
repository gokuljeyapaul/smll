import { test, expect } from '@playwright/test';
import { runPrivacyAudit, startCapture } from './helpers/privacy';
import { postShareTargetForm, readFixtureB64, waitForAppShellReady } from './helpers/pwa';

/**
 * A32 (R2-1, chromium-only platform ID — the share-target POST route is
 * Chromium's, as A08): an image shared into the installed app goes
 * STRAIGHT TO THE ANSWER. The service worker receives a real multipart
 * POST (the same handler Android's share sheet hits), OCR starts
 * automatically — no extra tap — with one clear progress state, and the
 * screen ends on the result: the text with a large Copy button first,
 * visible without scrolling at 390×844; clicking Copy puts exactly the
 * result text on the clipboard. The share POST body is never cached or
 * logged (A15's rules stay, re-audited here on this flow).
 *
 * A36: the share path's kind errors — a shared image with no readable
 * text lands on its specific no-text error plus ONE obvious next step
 * (the file picker); a share POST without an image stays ignored
 * fail-closed (A08's negative, unchanged).
 */
test.skip(
  ({ browserName }) => browserName !== 'chromium',
  'A32/A36: the share-target POST route is a Chromium-only platform ID (as A08); real Android installed-PWA sharing is A27 NOT_RUN',
);

const PHONE_VIEWPORT = { width: 390, height: 844 };

test('a32_share_target_lands_result_first_with_copy_visible_and_exact', async ({ page }) => {
  test.setTimeout(300_000);
  const capture = startCapture(page);
  await page.goto('/');
  await waitForAppShellReady(page);

  // A phone viewport: the result must put Copy above the fold, unscrolled.
  await page.setViewportSize(PHONE_VIEWPORT);

  // A real multipart POST through the service worker (as A08).
  const bytes = await readFixtureB64('fixtures/images/clean03.png');
  const res = await postShareTargetForm(page, { name: 'shared.png', type: 'image/png', bytes });
  expect(res.ok).toBe(true);

  // Auto-OCR, no extra tap: ONE clear progress state, announced politely.
  await expect(page.getByRole('status')).toBeVisible({ timeout: 30_000 });

  // The result screen ("Your text"), not the old pick-first home screen.
  await expect(page.getByRole('heading', { name: 'Your text' })).toBeVisible({ timeout: 150_000 });

  // Copy is the FIRST action and visible without scrolling at 390×844.
  const copy = page.locator('#copy-btn');
  await expect(copy).toBeVisible();
  const actionsOrder = await page.evaluate(() => {
    const wrap = document.getElementById('result-actions');
    const kids = wrap ? Array.from(wrap.children) : [];
    return kids.map((el) => el.id || el.getAttribute('data-testid') || el.tagName.toLowerCase());
  });
  expect(actionsOrder[0], 'the Copy button is the first result action').toBe('copy-btn');

  const box = await copy.boundingBox();
  expect(box, 'the Copy button has a box').toBeTruthy();
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.y + box!.height, 'Copy sits fully above the fold at 390×844').toBeLessThanOrEqual(844);

  // The text arrived (real in-browser OCR ran by itself)…
  await expect
    .poll(async () => (await page.locator('#review-text').inputValue()).length, {
      timeout: 150_000,
      message: 'real in-browser OCR to produce the result text',
    })
    .toBeGreaterThan(40);
  const resultText = await page.locator('#review-text').inputValue();

  // …and clicking Copy puts EXACTLY that text on the real clipboard.
  await copy.click();
  await expect
    .poll(async () => page.evaluate(() => navigator.clipboard.readText()), {
      timeout: 30_000,
      message: 'the clipboard to hold the copied result text',
    })
    .toBe(resultText);

  // Privacy (A15 on this flow): no post text in storage/URL/console/request,
  // and the share-target POST body was never cached or logged.
  const audit = await runPrivacyAudit(page, capture, [resultText]);
  expect(audit.violations, JSON.stringify(audit.violations, null, 2)).toEqual([]);
});

test('a36_shared_image_with_no_text_shows_kind_error_and_one_next_step', async ({ page }) => {
  test.setTimeout(300_000);
  await page.goto('/');
  await waitForAppShellReady(page);

  // A blank (text-free) image shared in — a real image, so the pipeline
  // runs and lands in the no-text kind error, never a silent empty screen.
  const bytes = await readFixtureB64('fixtures/images/blank01.png');
  const res = await postShareTargetForm(page, { name: 'blank.png', type: 'image/png', bytes });
  expect(res.ok).toBe(true);

  // The specific no-text message (A07's string, unchanged)…
  await expect(page.locator('.error-banner')).toContainText('No readable text was found', { timeout: 150_000 });
  // …plus ONE obvious next step (A36): the still-working file picker.
  await expect(page.locator('#error-next-step')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Choose screenshot' })).toBeVisible();
});

test('a36_share_post_without_an_image_stays_ignored', async ({ page }) => {
  await page.goto('/');
  await waitForAppShellReady(page);

  // A08's fail-closed negative, restated for the share-first path: a POST
  // with no image at all is ignored — nothing processed, no error state.
  const none = await postShareTargetForm(page, null);
  expect(none.ok).toBe(true);
  await expect(page.getByRole('heading', { name: 'PostClip' })).toBeVisible();
  await expect(page.locator('.error-banner')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Your text' })).toBeHidden();
});
