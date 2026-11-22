import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { runPrivacyAudit, startCapture } from './helpers/privacy';

/**
 * UC07 (A05, web): export the reviewed post as .md, .txt and .json; each
 * download is a real browser download whose file content is read back and
 * asserted. .md and .txt carry the review text verbatim; .json is the
 * deterministic {app, format, text} document. Ends with the A15 audit.
 */

async function pickAndWaitForReview(page: Page) {
  await page.setInputFiles('#file-input', 'fixtures/images/clean01.png');
  await expect(page.getByRole('heading', { name: 'Review' })).toBeVisible({ timeout: 120_000 });
  await expect
    .poll(async () => (await page.locator('#review-text').inputValue()).length, { timeout: 120_000 })
    .toBeGreaterThan(40);
}

test('uc07_export_downloads_md_txt_json', async ({ page }) => {
  const capture = startCapture(page);
  await page.goto('/');
  await pickAndWaitForReview(page);
  const reviewText = await page.locator('#review-text').inputValue();

  const expected: Record<string, string> = {
    md: reviewText,
    txt: reviewText,
    json: `${JSON.stringify({ app: 'postclip', format: 1, text: reviewText }, null, 2)}\n`,
  };

  for (const format of ['md', 'txt', 'json'] as const) {
    const downloadPromise = page.waitForEvent('download');
    await page.locator(`#export-${format}`).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe(`postclip-export.${format}`);
    const content = readFileSync(await download.path(), 'utf-8');
    expect(content, `the downloaded .${format} content`).toBe(expected[format]);
  }

  // The JSON document parses and carries exactly the review text.
  const downloadPromise = page.waitForEvent('download');
  await page.locator('#export-json').click();
  const download = await downloadPromise;
  const parsed = JSON.parse(readFileSync(await download.path(), 'utf-8')) as Record<string, unknown>;
  expect(Object.keys(parsed).sort()).toEqual(['app', 'format', 'text']);
  expect(parsed.text).toBe(reviewText);

  // A15 audit after the flow.
  const audit = await runPrivacyAudit(page, capture, [reviewText]);
  expect(audit.violations, JSON.stringify(audit.violations, null, 2)).toEqual([]);
});
