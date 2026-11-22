import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

/**
 * A20 (web): browser eval run — real in-browser OCR over the "clean" fixture
 * set through the app itself, computing character error rate (CER) against
 * the gold `ocr_expected` text, in Chromium and WebKit. The plan's initial
 * bar: clean-set CER ≤ 5% for the chosen engine. Per-fixture numbers are
 * printed in the test output (captured in the JUnit evidence) and in
 * docs/evidence/S0/ocr_engine_comparison.md.
 *
 * S1: the review textarea now shows the CLEANED text, so this eval reads
 * the raw pre-cleanup OCR text from the review screen's "original OCR"
 * view (#raw-ocr-text) — the measurement itself is unchanged: raw OCR CER
 * against gold ocr_expected.
 */

interface Gold {
  id: string;
  kind: string;
  ocr_expected: string[];
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const curr = [i];
    for (let j = 1; j <= n; j++) {
      curr[j] = Math.min(
        prev[j] + 1,
        curr[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = curr;
  }
  return prev[n];
}

/** Apply the same whitespace normalization the review text goes through. */
function normalizeLikeReview(lines: string[]): string {
  return lines
    .map((l) => l.replace(/[ \t]+/g, ' ').trim())
    .filter((l) => l.length > 0)
    .join('\n');
}

function cer(got: string, expected: string): number {
  if (expected.length === 0) return 1;
  return levenshtein(got, expected) / expected.length;
}

async function ocrFixture(page: Page, pngPath: string, id: string): Promise<string> {
  await page.goto('/');
  await page.setInputFiles('#file-input', pngPath);
  await expect
    .poll(async () => (await page.locator('#raw-ocr-text').textContent())?.length ?? 0, {
      timeout: 120_000,
      message: `OCR of ${id}`,
    })
    .toBeGreaterThan(0);
  const raw = await page.locator('#raw-ocr-text').textContent();
  if (raw === null) throw new Error(`raw OCR text missing for ${id}`);
  return raw;
}

test('eval_ocr_cer_clean_set', async ({ page }) => {
  const manifest = JSON.parse(readFileSync('fixtures/manifest.json', 'utf-8')) as {
    images: { id: string; file: string; gold: string }[];
  };
  const clean = manifest.images.map((img) => ({
    img,
    gold: JSON.parse(readFileSync(`fixtures/${img.gold}`, 'utf-8')) as Gold,
  })).filter((entry) => entry.gold.kind === 'clean');

  expect(clean.length, 'clean fixture set size').toBeGreaterThanOrEqual(6);

  const results: { id: string; cer: number }[] = [];
  for (const entry of clean) {
    const got = await ocrFixture(page, `fixtures/${entry.img.file}`, entry.img.id);
    const expected = normalizeLikeReview(entry.gold.ocr_expected);
    results.push({ id: entry.img.id, cer: cer(got, expected) });
  }

  const mean = results.reduce((sum, r) => sum + r.cer, 0) / results.length;
  const perFixture = results.map((r) => `${r.id}=${(r.cer * 100).toFixed(2)}%`).join(' ');
  console.log(`eval_ocr_cer_clean_set per-fixture: ${perFixture}`);
  console.log(`eval_ocr_cer_clean_set mean: ${(mean * 100).toFixed(2)}%`);

  expect(mean, `clean-set mean CER must be ≤ 5% (got ${(mean * 100).toFixed(2)}%)`).toBeLessThanOrEqual(0.05);
});
