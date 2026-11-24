import { test, expect, type Page } from '@playwright/test';
import { MODEL_SERVER, startModelServer } from './helpers/model-server';
import { readModelCacheState } from './helpers/model-cache';
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
  await expect(page.getByRole('heading', { name: 'Your text' })).toBeVisible({ timeout: 120_000 });
  await expect
    .poll(async () => (await page.locator('#review-text').inputValue()).length, {
      timeout: 120_000,
      message: 'real OCR + deterministic cleanup still produce review text',
    })
    .toBeGreaterThan(40);
  await expect(page.locator('#cleanup-mode')).toContainText('Standard cleanup');
  return page.locator('#review-text').inputValue();
}

/** Nothing from the model may remain in the model cache (purged), in either
 *  sanctioned backend (OPFS / Cache Storage — see helpers/model-cache.ts). */
async function assertModelCachePurged(page: Page): Promise<void> {
  const state = await readModelCacheState(page);
  if (state.opfsEntryBytes !== null || state.cacheStorageEntryBytes !== null || state.totalEntries !== 0) {
    throw new Error(`the bad model file must be purged from the model cache, saw ${JSON.stringify(state)}`);
  }
}

test('a13_wrong_hash_falls_back_with_banner_and_purges', async ({ page }) => {
  test.setTimeout(240_000); // a real 397 MB wrong-hash download + OCR pick
  await startModelServer();
  const capture = startCapture(page);

  await page.goto(`/?testModelUrl=${MODEL_SERVER}/model-wrong-hash`);
  await page.locator('#advanced-model summary').click(); // R2-3: opt-in section
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
  test.setTimeout(240_000); // a real 198 MB truncated download + OCR pick
  await startModelServer();
  const capture = startCapture(page);

  await page.goto(`/?testModelUrl=${MODEL_SERVER}/model-truncated`);
  await page.locator('#advanced-model summary').click(); // R2-3: opt-in section
  await page.locator('#model-download-btn').click();
  await expect(page.locator('#model-banner')).toBeVisible({ timeout: 120_000 });
  await expect(page.locator('#model-banner')).toContainText("didn't finish");

  await assertModelCachePurged(page);
  await assertStandardCleanupStillWorks(page);

  const audit = await runPrivacyAudit(page, capture, [], [MODEL_SERVER]);
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
  test.setTimeout(240_000); // banner + OCR pick on a slower machine
  await startModelServer();

  await page.goto(`/?testModelUrl=${MODEL_SERVER}/model-404`);
  await page.locator('#advanced-model summary').click(); // R2-3: opt-in section
  await page.locator('#model-download-btn').click();
  await expect(page.locator('#model-banner')).toBeVisible({ timeout: 120_000 });
  await expect(page.locator('#model-banner')).toContainText('could not be reached');

  await assertModelCachePurged(page);
  await assertStandardCleanupStillWorks(page);
});
