import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { runPrivacyAudit, startCapture } from './helpers/privacy';
import {
  bodyTokenF1,
  chromeLeakageRate,
  fabricatedTokenRate,
} from '../src/cleanup/metrics';

/**
 * Cleanup-quality eval on REAL browser-OCR output (the plan's "the cleanup
 * evaluation uses the real OCR output of the chosen browser engine"): run
 * each standard-set fixture through the app's real pipeline (OCR → gate →
 * cleanup) in this engine, then measure body-token F1, chrome leakage and
 * fabricated-token rate against the gold body. Standard set = the S0 ten
 * (clean/dark/chrome) + the S1 heavychrome and longpost fixtures.
 *
 * Bars (plan "Fixtures and metrics", P0): body-token F1 >= 0.95,
 * chrome leakage <= 2%, fabricated-token rate <= 2% on the standard set.
 * The variant fixtures (emoji, blur, low contrast, huge) are measured
 * host-side on gold input (src/cleanup/cleanup.test.ts) and their
 * real-OCR behavior is exercised by the uc11/uc05 flows; the LLM-era
 * browser eval over all variants is A19 (S4).
 */

interface Gold {
  id: string;
  kind: string;
  body: string[];
  chrome: string[];
  ocr_expected: string[];
}

const STANDARD_KINDS = new Set(['clean', 'dark', 'chrome', 'heavychrome', 'longpost']);

async function ocrFixture(page: Page, pngPath: string, id: string): Promise<{ cleaned: string; raw: string }> {
  await page.goto('/');
  await page.setInputFiles('#file-input', pngPath);
  await expect
    .poll(async () => (await page.locator('#review-text').inputValue()).length, {
      timeout: 120_000,
      message: `OCR + cleanup of ${id}`,
    })
    .toBeGreaterThan(0);
  const cleaned = await page.locator('#review-text').inputValue();
  const raw = await page.locator('#raw-ocr-text').textContent();
  if (raw === null) throw new Error(`raw OCR text missing for ${id}`);
  return { cleaned, raw };
}

test('eval_cleanup_body_f1_standard_set', async ({ page }) => {
  test.setTimeout(420_000);
  const capture = startCapture(page);

  const manifest = JSON.parse(readFileSync('fixtures/manifest.json', 'utf-8')) as {
    images: { id: string; file: string; gold: string }[];
  };
  const entries = manifest.images
    .map((img) => ({
      img,
      gold: JSON.parse(readFileSync(`fixtures/${img.gold}`, 'utf-8')) as Gold,
    }))
    .filter((e) => STANDARD_KINDS.has(e.gold.kind));

  expect(entries.length, 'standard fixture set size').toBe(12);

  const results: { id: string; f1: number; leakage: number; fabricated: number }[] = [];
  for (const entry of entries) {
    const { cleaned, raw } = await ocrFixture(page, `fixtures/${entry.img.file}`, entry.img.id);
    const body = entry.gold.body.join('\n');
    results.push({
      id: entry.img.id,
      f1: bodyTokenF1(cleaned, body),
      leakage: chromeLeakageRate(cleaned, body, entry.gold.chrome),
      fabricated: fabricatedTokenRate(cleaned, raw),
    });
  }

  const meanF1 = results.reduce((s, r) => s + r.f1, 0) / results.length;
  const meanLeakage = results.reduce((s, r) => s + r.leakage, 0) / results.length;
  const meanFabricated = results.reduce((s, r) => s + r.fabricated, 0) / results.length;
  const perFixture = results.map((r) => `${r.id}:F1=${r.f1.toFixed(3)},leak=${r.leakage.toFixed(3)},fab=${r.fabricated.toFixed(3)}`).join(' ');
  console.log(`eval_cleanup per-fixture: ${perFixture}`);
  console.log(
    `eval_cleanup means over ${results.length} standard fixtures: F1=${meanF1.toFixed(3)} chrome_leakage=${meanLeakage.toFixed(3)} fabricated=${meanFabricated.toFixed(3)}`,
  );

  expect(meanF1, `standard-set body-token F1 must be >= 0.95 (got ${meanF1.toFixed(3)})`).toBeGreaterThanOrEqual(0.95);
  expect(meanLeakage, `chrome leakage must be <= 2% (got ${(meanLeakage * 100).toFixed(2)}%)`).toBeLessThanOrEqual(0.02);
  expect(meanFabricated, `fabricated-token rate must be <= 2% (got ${(meanFabricated * 100).toFixed(2)}%)`).toBeLessThanOrEqual(0.02);

  // A15 audit after the eval flow (the last fixture's post text must not leak).
  const last = entries[entries.length - 1].gold.body.join('\n');
  const audit = await runPrivacyAudit(page, capture, [last]);
  expect(audit.violations, JSON.stringify(audit.violations, null, 2)).toEqual([]);
});
