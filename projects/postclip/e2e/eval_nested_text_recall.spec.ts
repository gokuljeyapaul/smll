import { test, expect, type Page } from '@playwright/test';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';

/**
 * A35 (R2-1, web — Chromium AND WebKit): text INSIDE images within the
 * screenshot (quoted/reshared cards, banner overlays rendered as real
 * rasterized pictures) is included in the extracted text. The nested
 * fixture set (>= 3 synthetic screenshots, ground truth committed in each
 * gold JSON as `nested_image_text`) is run through the app's REAL OCR in
 * the browser, and the nested-token recall is computed against the raw
 * pre-cleanup OCR output. Per-fixture numbers are printed (JUnit evidence)
 * and written to docs/evidence/R2-1/nested-text-recall-<engine>.json; the
 * plan's stated bar is asserted, and KNOWN_LIMITS.md carries the honest
 * measured limit.
 */
interface Gold {
  id: string;
  kind: string;
  language: string;
  body: string[];
  chrome: string[];
  ocr_expected: string[];
  nested_image_text?: string[];
}

/** Tokens for recall: lowercase, punctuation-stripped, length >= 2. */
function tokens(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9][a-z0-9'’-]*/g) ?? []).filter((t) => t.length >= 2);
}

/** Fraction of the nested-image ground-truth tokens recovered in the OCR
 * output (multiset semantics: an over-repeated OCR token cannot inflate
 * the recall — each gold token consumes at most one OCR match). */
function tokenRecall(goldText: string, ocrText: string): number {
  const goldTokens = tokens(goldText);
  if (goldTokens.length === 0) return 1;
  const pool = new Map<string, number>();
  for (const t of tokens(ocrText)) pool.set(t, (pool.get(t) ?? 0) + 1);
  let recovered = 0;
  for (const t of goldTokens) {
    const left = pool.get(t) ?? 0;
    if (left > 0) {
      recovered += 1;
      pool.set(t, left - 1);
    }
  }
  return recovered / goldTokens.length;
}

/** The stated bar (plan A35): at least 75% of the nested-image tokens are
 * recovered by the real OCR pass in each engine, on each fixture. */
const NESTED_RECALL_BAR = 0.75;

async function ocrRawText(page: Page, pngPath: string, id: string): Promise<string> {
  await page.goto('/');
  await page.setInputFiles('#file-input', pngPath);
  await expect
    .poll(async () => (await page.locator('#raw-ocr-text').textContent())?.length ?? 0, {
      timeout: 150_000,
      message: `OCR of ${id}`,
    })
    .toBeGreaterThan(0);
  const raw = await page.locator('#raw-ocr-text').textContent();
  if (raw === null) throw new Error(`raw OCR text missing for ${id}`);
  return raw;
}

test('eval_nested_text_recall_on_fixtures', async ({ page, browserName }) => {
  test.setTimeout(420_000);
  const manifest = JSON.parse(readFileSync('fixtures/manifest.json', 'utf-8')) as {
    images: { id: string; file: string; gold: string }[];
  };
  const nested = manifest.images
    .map((img) => ({ img, gold: JSON.parse(readFileSync(`fixtures/${img.gold}`, 'utf-8')) as Gold }))
    .filter((e) => e.gold.kind === 'nested' && Array.isArray(e.gold.nested_image_text));

  // The plan's fixture set: >= 3 synthetic nested-text screenshots.
  expect(nested.length, 'the nested fixture set (>= 3, ground truth committed)').toBeGreaterThanOrEqual(3);

  const rows: { id: string; recall: number }[] = [];
  for (const { img, gold } of nested) {
    const raw = await ocrRawText(page, `fixtures/${img.file}`, img.id);
    const recall = tokenRecall((gold.nested_image_text ?? []).join('\n'), raw);
    rows.push({ id: img.id, recall });
    console.log(`eval_nested_text_recall ${browserName} ${img.id}: nested-token recall=${(recall * 100).toFixed(1)}%`);
    expect(recall, `${img.id}: nested-token recall must meet the stated bar (>= ${(NESTED_RECALL_BAR * 100).toFixed(0)}%)`)
      .toBeGreaterThanOrEqual(NESTED_RECALL_BAR);
  }

  const mean = rows.reduce((s, r) => s + r.recall, 0) / rows.length;
  console.log(`eval_nested_text_recall ${browserName}: mean=${(mean * 100).toFixed(1)}% bar=${(NESTED_RECALL_BAR * 100).toFixed(0)}%`);

  // Evidence copy for the committed table (the building host's run is what
  // gets committed; CI re-runs the same spec independently).
  const slug = browserName === 'chromium' ? 'chromium' : browserName;
  mkdirSync('docs/evidence/R2-1', { recursive: true });
  writeFileSync(
    `docs/evidence/R2-1/nested-text-recall-${slug}.json`,
    JSON.stringify({ engine: browserName, bar: NESTED_RECALL_BAR, mean, rows }, null, 2) + '\n',
  );
});
