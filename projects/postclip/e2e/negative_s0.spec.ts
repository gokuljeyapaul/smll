import { test, expect } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';

/**
 * S0 negative path (fail closed): a corrupt "PNG" (not an image at all) never
 * crashes the app, never shows an empty review, and leaves a visible error —
 * the previous safe stage — instead. The full bad-input matrix (tiny, huge,
 * non-image, blank) is S1/A07; this pins the pipeline's failure behavior.
 */
test('s0_negative_corrupt_input_fails_closed', async ({ page }) => {
  mkdirSync('test-results', { recursive: true });
  const corruptPath = 'test-results/s0-corrupt-input.png';
  writeFileSync(corruptPath, 'this is definitely not a PNG image, just bytes\n');

  const pageErrors: string[] = [];
  page.on('pageerror', (err) => pageErrors.push(String(err)));

  await page.goto('/');
  await page.setInputFiles('#file-input', corruptPath);

  await expect(page.locator('.error-banner')).toBeVisible({ timeout: 120_000 });
  const banner = await page.locator('.error-banner').textContent();
  expect(banner).toContain('Could not read');

  // The app is still alive and usable: the picker is still reachable.
  await expect(page.getByRole('button', { name: 'Choose screenshot' })).toBeVisible();
  expect(pageErrors).toEqual([]);
});
