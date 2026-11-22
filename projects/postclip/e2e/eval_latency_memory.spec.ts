import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

/**
 * A22 (web — both engines): latency and memory budgets, headless-Linux
 * numbers ONLY (plan: "recorded as headless-Linux numbers only").
 *
 * Budgets asserted (the app's DEFAULT pipeline — deterministic rules):
 *   OCR    <= 5 s per fixture  (the plan's A22 OCR budget, measured per
 *                                fixture on the clean set; the postclip:ocr
 *                                User-Timing measure IS the OCR stage)
 *   cleanup <= 60 s per fixture (the DEFAULT deterministic cleanup is
 *                                measured in-page via postclip:cleanup;
 *                                the same 60 s budget is host-tested over
 *                                every fixture's gold input in
 *                                src/cleanup/cleanup-latency.test.ts)
 *
 * The OPT-IN LLM cleanup path is NOT asserted against the 60 s budget: S4
 * measured it at 65-236 s per pick on the single-threaded WASM path (below
 * the baseline on quality too), so it ships DISABLED BY DEFAULT (A19). Its
 * real numbers are re-measured on every tree by
 * e2e/eval_llm_vs_baseline.spec.ts (chromium) and recorded in the slice
 * summary as measured limitations — never as a passing budget.
 *
 * Memory: peak usedJSHeapSize is recorded per fixture where the engine
 * exposes performance.memory (headless Chromium does; this WebKit build does
 * not — recorded as null, an honest engine limitation, not a skip).
 */
interface Gold {
  id: string;
  kind: string;
}

interface Measurement {
  id: string;
  wallMs: number;
  decodeMs: number | null;
  downscaleMs: number | null;
  ocrMs: number | null;
  cleanupMs: number | null;
  heapMiB: number | null;
}

const OCR_BUDGET_MS = 5_000;
const CLEANUP_BUDGET_MS = 60_000;

async function readLastMeasure(page: Page, name: string): Promise<number | null> {
  return page.evaluate((n) => {
    const entries = performance.getEntriesByName(n);
    if (entries.length === 0) return null;
    return Math.round(entries[entries.length - 1].duration);
  }, name);
}

async function pickAndMeasure(page: Page, path: string, id: string): Promise<Measurement> {
  const wall0 = Date.now();
  await page.setInputFiles('#file-input', path);
  await page.waitForFunction(() => {
    const el = document.querySelector('#review-text') as HTMLTextAreaElement | null;
    return el !== null && el.value.length > 0;
  }, null, { timeout: 120_000 });
  const wallMs = Date.now() - wall0;
  const heapMiB = await page.evaluate(() => {
    const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
    return mem ? Math.round(mem.usedJSHeapSize / 1048576) : null;
  });
  return {
    id,
    wallMs,
    decodeMs: await readLastMeasure(page, 'postclip:decode'),
    downscaleMs: await readLastMeasure(page, 'postclip:downscale'),
    ocrMs: await readLastMeasure(page, 'postclip:ocr'),
    cleanupMs: await readLastMeasure(page, 'postclip:cleanup'),
    heapMiB,
  };
}

test('eval_latency_budgets_clean_set', async ({ page }) => {
  test.setTimeout(420_000);
  const manifest = JSON.parse(readFileSync('fixtures/manifest.json', 'utf-8')) as {
    images: { id: string; file: string; gold: string }[];
  };
  const clean = manifest.images
    .map((img) => ({ img, gold: JSON.parse(readFileSync(`fixtures/${img.gold}`, 'utf-8')) as Gold }))
    .filter((e) => e.gold.kind === 'clean');
  expect(clean.length, 'clean fixture set size').toBeGreaterThanOrEqual(6);

  await page.goto('/');
  const results: Measurement[] = [];
  for (const [i, entry] of clean.entries()) {
    if (i > 0) await page.getByRole('button', { name: 'Start over' }).click();
    results.push(await pickAndMeasure(page, `fixtures/${entry.img.file}`, entry.img.id));
  }

  const engine = test.info().project.name;
  for (const r of results) {
    console.log(
      `eval_latency ${engine} ${r.id}: wall=${r.wallMs}ms decode=${r.decodeMs} downscale=${r.downscaleMs} ocr=${r.ocrMs} cleanup=${r.cleanupMs} heap=${r.heapMiB === null ? 'n/a' : r.heapMiB + 'MiB'} (headless-Linux)`,
    );
  }
  const peakHeap = Math.max(...results.map((r) => r.heapMiB ?? 0)) || null;
  console.log(
    `eval_latency ${engine}: ${results.length} clean fixtures, peak usedJSHeapSize ${peakHeap === null ? 'NOT_RUN (engine exposes no performance.memory — recorded, not skipped)' : peakHeap + ' MiB'} (headless-Linux)`,
  );

  // A22 budgets: OCR <= 5 s and default cleanup <= 60 s, per fixture.
  for (const r of results) {
    expect(r.ocrMs, `OCR stage for ${r.id} (headless-Linux) must be <= ${OCR_BUDGET_MS} ms`).toBeLessThanOrEqual(OCR_BUDGET_MS);
    expect(r.cleanupMs, `default cleanup for ${r.id} must complete (<= ${CLEANUP_BUDGET_MS} ms)`).toBeLessThanOrEqual(CLEANUP_BUDGET_MS);
  }
});
