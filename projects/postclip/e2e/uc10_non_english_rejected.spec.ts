import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { NON_ENGLISH_MESSAGE } from '../src/language/gate';
import { runPrivacyAudit, startCapture } from './helpers/privacy';

/**
 * UC10 (A06, web): non-English screenshots are rejected with a clear
 * message AFTER OCR and BEFORE any cleanup runs — the review screen never
 * appears, nothing is cleaned, copied or exported. Both German and Spanish
 * fixtures are rejected, and an English post still processes afterwards
 * (recovery). Ends with the A15 audit over the German, Spanish and English
 * post text.
 */

function fixtureFile(id: string): string {
  const manifest = JSON.parse(readFileSync('fixtures/manifest.json', 'utf-8')) as {
    images: { id: string; file: string }[];
  };
  const entry = manifest.images.find((i) => i.id === id);
  if (!entry) throw new Error(`fixture ${id} missing from manifest`);
  return `fixtures/${entry.file}`;
}

async function expectRejected(page: Page, id: string) {
  await page.setInputFiles('#file-input', fixtureFile(id));
  const banner = page.locator('.error-banner');
  await expect(banner).toBeVisible({ timeout: 120_000 });
  await expect(banner).toHaveText(NON_ENGLISH_MESSAGE);
  // Cleanup never ran: no review screen, no review text anywhere.
  await expect(page.getByRole('heading', { name: 'Review' })).toHaveCount(0);
  await expect(page.locator('#review-text')).toHaveCount(0);
  // The app stays usable: the picker is right there.
  await expect(page.getByRole('button', { name: 'Choose screenshot' })).toBeVisible();
}

test('uc10_non_english_rejected_no_cleanup', async ({ page }) => {
  const capture = startCapture(page);
  await page.goto('/');

  await expectRejected(page, 'de01');
  await expectRejected(page, 'es01');
  await expectRejected(page, 'de02');

  // Recovery: an English post still processes to the review screen.
  await page.setInputFiles('#file-input', fixtureFile('clean01'));
  await expect(page.getByRole('heading', { name: 'Review' })).toBeVisible({ timeout: 120_000 });
  await expect
    .poll(async () => (await page.locator('#review-text').inputValue()).length, { timeout: 120_000 })
    .toBeGreaterThan(40);

  // A15: none of the rejected or accepted post text leaked anywhere.
  const forbidden: string[] = [];
  for (const id of ['de01', 'es01', 'de02', 'clean01']) {
    const gold = JSON.parse(readFileSync(`fixtures/gold/${id}.json`, 'utf-8')) as { body: string[] };
    forbidden.push(gold.body.join('\n'));
  }
  const audit = await runPrivacyAudit(page, capture, forbidden);
  expect(audit.violations, JSON.stringify(audit.violations, null, 2)).toEqual([]);
});
