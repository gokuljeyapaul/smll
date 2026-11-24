import { test, expect } from '@playwright/test';
import { runPrivacyAudit, startCapture } from './helpers/privacy';

/**
 * A33 (R2-1, web — Chromium AND WebKit): EVERY arrival channel lands on
 * the result-first screen. The pick path is the engine-neutral channel:
 * pick a fixture, real OCR runs, and the screen is the answer — Copy is
 * the first, primary action and sits fully above the fold at 390×844;
 * Share and the file-save menu come next; the editable text comes after
 * the actions; and none of the home screen's input furniture (drop zone,
 * paste button, model card, model toggle) is on this path.
 */
async function spyNavigatorShare(page: import('@playwright/test').Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __shareCalls: unknown[] };
    w.__shareCalls = [];
    Object.defineProperty(navigator, 'share', {
      value: (data: ShareData) => {
        w.__shareCalls.push(data);
        return Promise.resolve();
      },
      configurable: true,
      writable: true,
    });
  });
}

test('a33_every_arrival_lands_result_first_copy_primary_then_share_save_then_edit', async ({ page }) => {
  test.setTimeout(300_000);
  const capture = startCapture(page);
  await spyNavigatorShare(page);

  // A phone viewport: the primary action must be visible unscrolled.
  await page.setViewportSize({ width: 390, height: 844 });

  await page.goto('/');
  await page.setInputFiles('#file-input', 'fixtures/images/clean01.png');

  // The result screen ("Your text") with the real OCR text.
  await expect(page.getByRole('heading', { name: 'Your text' })).toBeVisible({ timeout: 150_000 });
  await expect
    .poll(async () => (await page.locator('#review-text').inputValue()).length, {
      timeout: 150_000,
      message: 'real in-browser OCR to produce the result text',
    })
    .toBeGreaterThan(40);

  // Home-screen input furniture is NOT on this path.
  await expect(page.getByTestId('dropzone')).toHaveCount(0);
  await expect(page.locator('#paste-btn')).toHaveCount(0);
  await expect(page.locator('#model-download-btn')).toHaveCount(0);

  // The action order: Copy first, Share second, the save-file menu third.
  const order = await page.evaluate(() => {
    const wrap = document.getElementById('result-actions');
    const kids = wrap ? Array.from(wrap.children) : [];
    return kids.map((el) => el.id || el.getAttribute('data-testid') || el.tagName.toLowerCase());
  });
  expect(order.slice(0, 3)).toEqual(['copy-btn', 'share-btn', 'export-menu']);

  // Copy is visibly the primary: bigger than the secondary Share button.
  const copyBox = await page.locator('#copy-btn').boundingBox();
  const shareBox = await page.locator('#share-btn').boundingBox();
  expect(copyBox, 'the Copy button has a box').toBeTruthy();
  expect(shareBox, 'the Share button has a box').toBeTruthy();
  expect(copyBox!.height, 'Copy is the LARGE action (taller than Share)').toBeGreaterThan(shareBox!.height * 1.2);
  expect(copyBox!.width, 'Copy is the LARGE action (wider than Share)').toBeGreaterThan(shareBox!.width * 1.2);

  // Copy sits fully above the fold at 390×844 — no scrolling to reach it.
  expect(copyBox!.y + copyBox!.height, 'Copy is fully above the fold at 390×844').toBeLessThanOrEqual(844);

  // Edit comes AFTER the actions (the text is secondary to the answer).
  const textBox = await page.locator('#review-text').boundingBox();
  expect(textBox!.y, 'the editable text starts below the action row').toBeGreaterThan(copyBox!.y + copyBox!.height);

  // The model opt-in stays reachable but collapsed out of the way: with
  // no ready model there is no toggle at all (a21's rule); with one, it
  // lives inside the closed #advanced-cleanup disclosure (asserted in a21
  // on the real model). Here: no toggle on the reading/result path.
  await expect(page.locator('#llm-cleanup-toggle')).toHaveCount(0);

  // Copy works from this screen too (the primary action is real).
  const resultText = await page.locator('#review-text').inputValue();
  await page.locator('#copy-btn').click();
  await expect(page.locator('.copied-note')).toBeVisible();

  // No-storage audit on the flow (A15 rules unchanged).
  const audit = await runPrivacyAudit(page, capture, [resultText]);
  expect(audit.violations, JSON.stringify(audit.violations, null, 2)).toEqual([]);
});
