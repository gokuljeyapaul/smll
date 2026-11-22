import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { ERROR_MESSAGES, DOWNSCALE_NOTE } from '../src/image/validate';
import { NO_TEXT_MESSAGE } from '../src/ocr/normalize';
import { runPrivacyAudit, startCapture } from './helpers/privacy';

/**
 * UC11 (A07, web): the bad-input matrix. Non-image, corrupt, tiny and blank
 * inputs each produce their OWN specific message, never a crash, and the
 * app stays usable. The huge (≥ 4000 px) fixture is downscaled before OCR
 * and processed to the review screen with a visible note. Ends with the
 * A15 audit.
 */

const pageErrors: string[] = [];

function fixtureFile(id: string): string {
  const manifest = JSON.parse(readFileSync('fixtures/manifest.json', 'utf-8')) as {
    images: { id: string; file: string }[];
  };
  const entry = manifest.images.find((i) => i.id === id);
  if (!entry) throw new Error(`fixture ${id} missing from manifest`);
  return `fixtures/${entry.file}`;
}

async function pick(page: Page, file: string) {
  await page.setInputFiles('#file-input', file);
}

async function expectErrorState(page: Page, message: string) {
  const banner = page.locator('.error-banner');
  await expect(banner).toBeVisible({ timeout: 120_000 });
  await expect(banner).toHaveText(message);
  // No review screen for bad inputs, and the app stays usable.
  await expect(page.getByRole('heading', { name: 'Review' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Choose screenshot' })).toBeVisible();
}

test.beforeEach(() => {
  pageErrors.length = 0;
});

test('uc11_bad_input_error_states', async ({ page }) => {
  page.on('pageerror', (err) => pageErrors.push(String(err)));
  const capture = startCapture(page);
  await page.goto('/');

  // A text file is not an image at all.
  await pick(page, fixtureFile('nonimage01'));
  await expectErrorState(page, ERROR_MESSAGES['non-image']);

  // A PNG header with a truncated stream is corrupt.
  await pick(page, fixtureFile('corrupt01'));
  await expectErrorState(page, ERROR_MESSAGES.corrupt);

  // A 64×64 image is too small to read — rejected before OCR runs.
  await pick(page, fixtureFile('tiny01'));
  await expectErrorState(page, ERROR_MESSAGES.tiny);

  // A blank image decodes but contains no readable text.
  await pick(page, fixtureFile('blank01'));
  await expectErrorState(page, NO_TEXT_MESSAGE);

  expect(pageErrors, 'bad inputs must never crash the page').toEqual([]);

  // A15 audit after the whole bad-input matrix.
  const audit = await runPrivacyAudit(page, capture, []);
  expect(audit.violations, JSON.stringify(audit.violations, null, 2)).toEqual([]);
});

test('uc11_huge_downscaled_before_ocr', async ({ page }) => {
  page.on('pageerror', (err) => pageErrors.push(String(err)));
  const capture = startCapture(page);
  await page.goto('/');

  const gold = JSON.parse(readFileSync('fixtures/gold/huge01.json', 'utf-8')) as { body: string[] };

  await pick(page, fixtureFile('huge01'));
  // The downscale note is visible while reading.
  await expect(page.locator('#downscale-note')).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('#downscale-note')).toHaveText(DOWNSCALE_NOTE);
  // The image is processed to the review screen with the body text.
  await expect(page.getByRole('heading', { name: 'Review' })).toBeVisible({ timeout: 180_000 });
  await expect
    .poll(async () => (await page.locator('#review-text').inputValue()).length, { timeout: 180_000 })
    .toBeGreaterThan(40);
  const reviewText = await page.locator('#review-text').inputValue();
  expect(reviewText).toContain(gold.body[0]);
  expect(reviewText, 'the huge input went through cleanup too').not.toContain('Like Comment Share');

  expect(pageErrors, 'the huge image must not crash the page').toEqual([]);

  const audit = await runPrivacyAudit(page, capture, [gold.body.join('\n'), reviewText]);
  expect(audit.violations, JSON.stringify(audit.violations, null, 2)).toEqual([]);
});
