import { test, expect, type Page } from '@playwright/test';
import { MODEL_SERVER, startModelServer } from './helpers/model-server';
import { runPrivacyAudit, startCapture } from './helpers/privacy';

/**
 * UC09 (A13, web platform — Chromium AND WebKit): a checksum mismatch, a
 * truncated file, an HTTP 404, or an unsupported browser each leave the app
 * in fallback mode with an EXPLICIT banner, the bad file purged (nothing in
 * the model cache), and the OCR + deterministic-cleanup path still passing
 * (A02 re-verified: a real pick produces the cleaned review text).
 */

/** Run the A02 pick path and assert the fallback still cleans the post. */
async function assertStandardCleanupStillWorks(page: Page): Promise<string> {
  await page.setInputFiles('#file-input', 'fixtures/images/clean01.png');
  await expect(page.getByRole('heading', { name: 'Review' })).toBeVisible({ timeout: 120_000 });
  await expect
    .poll(async () => (await page.locator('#review-text').inputValue()).length, {
      timeout: 120_000,
      message: 'real OCR + deterministic cleanup still produce review text',
    })
    .toBeGreaterThan(40);
  await expect(page.locator('#cleanup-mode')).toContainText('Standard cleanup');
  return page.locator('#review-text').inputValue();
}

/** Nothing from the model may remain in the model cache (purged). */
async function assertModelCachePurged(page: Page): Promise<void> {
  const purged = await page.evaluate(async () => {
    if (typeof caches === 'undefined') return { empty: true };
    const names = await caches.keys();
    const model = names.find((n) => n.startsWith('postclip-model'));
    if (!model) return { empty: true };
    const keys = await (await caches.open(model)).keys();
    return { empty: keys.length === 0 };
  });
  expect(purged.empty, 'the bad file must be purged from the model cache').toBe(true);
}

test('a13_wrong_hash_falls_back_with_banner_and_purges', async ({ page }) => {
  await startModelServer();
  const capture = startCapture(page);

  await page.goto(`/?testModelUrl=${MODEL_SERVER}/model-wrong-hash`);
  await page.locator('#model-download-btn').click();
  await expect(page.locator('#model-banner')).toBeVisible({ timeout: 120_000 });
  await expect(page.locator('#model-banner')).toContainText('integrity check');
  await expect(page.locator('#model-banner')).toContainText('standard rules');

  await assertModelCachePurged(page);
  const reviewText = await assertStandardCleanupStillWorks(page);

  const audit = await runPrivacyAudit(page, capture, [reviewText], [MODEL_SERVER]);
  expect(audit.violations, JSON.stringify(audit.violations, null, 2)).toEqual([]);
});

test('a13_truncated_file_falls_back_and_purges', async ({ page }) => {
  await startModelServer();
  const capture = startCapture(page);

  await page.goto(`/?testModelUrl=${MODEL_SERVER}/model-truncated`);
  await page.locator('#model-download-btn').click();
  await expect(page.locator('#model-banner')).toBeVisible({ timeout: 120_000 });
  await expect(page.locator('#model-banner')).toContainText("didn't finish");

  await assertModelCachePurged(page);
  await assertStandardCleanupStillWorks(page);

  const audit = await runPrivacyAudit(page, capture, []);
  expect(audit.violations, JSON.stringify(audit.violations, null, 2)).toEqual([]);
});

test('a13_unsupported_browser_banner_and_picker_works', async ({ page }) => {
  const capture = startCapture(page);

  // Test-only capability-probe override (test builds only, A29): the probe
  // reports the browser cannot run the model, without any server involved.
  await page.goto('/?testProbe=unsupported');
  await expect(page.locator('#model-banner')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('#model-banner')).toContainText("can't run");
  await expect(page.locator('#model-download-btn')).toHaveCount(0);

  await assertModelCachePurged(page);
  await assertStandardCleanupStillWorks(page);

  const audit = await runPrivacyAudit(page, capture, []);
  expect(audit.violations, JSON.stringify(audit.violations, null, 2)).toEqual([]);
});

test('a13_model_404_falls_back_and_purges', async ({ page }) => {
  await startModelServer();

  await page.goto(`/?testModelUrl=${MODEL_SERVER}/model-404`);
  await page.locator('#model-download-btn').click();
  await expect(page.locator('#model-banner')).toBeVisible({ timeout: 120_000 });
  await expect(page.locator('#model-banner')).toContainText('could not be reached');

  await assertModelCachePurged(page);
  await assertStandardCleanupStillWorks(page);
});
