import { test, expect } from '@playwright/test';
import { ERROR_MESSAGES } from '../src/image/validate';

/**
 * S0 negative path (fail closed), evolved for S1 (A07): a corrupt "PNG"
 * (valid PNG magic + IHDR, truncated stream — the committed corrupt01.png
 * fixture) never crashes the app, never shows an empty review, and leaves
 * the SPECIFIC corrupt-input error — the previous safe stage — instead.
 * The message is the app's own ERROR_MESSAGES.corrupt string. The full
 * bad-input matrix (non-image, tiny, blank, huge) is uc11_bad_inputs.spec.
 */
test('s0_negative_corrupt_input_fails_closed', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (err) => pageErrors.push(String(err)));

  await page.goto('/');
  await page.setInputFiles('#file-input', 'fixtures/images/corrupt01.png');

  await expect(page.locator('.error-banner')).toBeVisible({ timeout: 120_000 });
  const banner = await page.locator('.error-banner').textContent();
  expect(banner).toBe(ERROR_MESSAGES.corrupt);

  // The app is still alive and usable: the picker is still reachable.
  await expect(page.getByRole('button', { name: 'Choose screenshot' })).toBeVisible();
  expect(pageErrors).toEqual([]);
});
