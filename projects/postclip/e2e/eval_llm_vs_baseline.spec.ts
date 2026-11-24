import { test, expect, type Page } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { MODEL_SERVER, startModelServer } from './helpers/model-server';
import { bodyTokenF1, chromeLeakageRate, fabricatedTokenRate } from '../src/cleanup/metrics';

/**
 * A19 (S4, host platform — browser eval on the WASM path): cleanup quality
 * on REAL browser-OCR output for BOTH cleanup modes on the same pick — the
 * deterministic baseline vs the real pinned model through the app — so the
 * LLM-vs-baseline margin is measured, not asserted. This spec RECORDS the
 * numbers (per-fixture JSON evidence + a console table) and asserts only
 * the SAFETY invariants that must hold regardless of which mode wins:
 * every fixture ends in a designed state (applied | unavailable), the
 * shown text is always the deterministic or the validated model result,
 * injection markers never reach metadata, and every applied model text
 * passed the deterministic guard.
 *
 * Chromium-only by design: A19's platform row is `host` with the browser
 * eval on the WASM path (headless Chromium on Linux; WebKit on this build
 * cannot load the 397 MB weights — measured in model_selection.md — and
 * A21's web-platform spec covers the fallback there).
 */

test.skip(
  ({ browserName }) => browserName !== 'chromium',
  'A19 is a host-platform browser eval on the WASM path in headless Chromium (plan platform table); the web-platform A21 spec covers WebKit',
);

interface Gold {
  id: string;
  kind: string;
  body: string[];
  chrome: string[];
  injection?: { markers: string[] };
}

const STANDARD_KINDS = new Set(['clean', 'dark', 'chrome', 'heavychrome', 'longpost']);

interface LlmDebug {
  mode: 'off' | 'applied' | 'unavailable';
  modelText: string | null;
  deterministicText: string;
  rawModelText: string | null;
  guardVerdict: string | null;
  author: string | null;
  tags: string[];
  summary: string | null;
  removedChrome: string[];
  latencyMs: number;
  attempts: number;
}

async function readDebug(page: Page): Promise<LlmDebug> {
  return page.evaluate(() => {
    const w = window as unknown as { __postclipLlmDebug?: LlmDebug };
    return w.__postclipLlmDebug as LlmDebug;
  });
}

test('eval_llm_vs_baseline_standard_and_injection_sets', async ({ page, browserName }) => {
  test.setTimeout(7_200_000); // 22 fixtures x (OCR + real wasm inference); single-threaded (scheduling budget; each settle is bounded by the pipeline's 240 s cap, so the all-fallback worst case ~100 min fits)
  await startModelServer();
  await page.goto(`/?testModelUrl=${MODEL_SERVER}/model`);
  await page.locator('#advanced-model summary').click(); // R2-3: opt-in section
  await page.locator('#model-download-btn').click();
  await expect(page.locator('#model-ready')).toBeVisible({ timeout: 240_000 });
  // Bounded wait (fails fast and clear when the model-cleanup UI is absent).
  await page.locator('#llm-cleanup-toggle').waitFor({ timeout: 30_000 });
  await page.locator('#llm-cleanup-toggle').check();

  const manifest = JSON.parse(readFileSync('fixtures/manifest.json', 'utf-8')) as {
    images: { id: string; file: string; gold: string }[];
  };
  const entries = manifest.images
    .map((img) => ({ img, gold: JSON.parse(readFileSync(`fixtures/${img.gold}`, 'utf-8')) as Gold }))
    .filter((e) => STANDARD_KINDS.has(e.gold.kind) || e.gold.kind === 'injection');
  expect(entries.length).toBe(22); // 17 standard + 5 injection

  interface Row {
    id: string;
    kind: string;
    mode: string;
    guardVerdict: string | null;
    attempts: number;
    latencyMs: number;
    baseline: { f1: number; leakage: number; fabricated: number };
    model: { f1: number; leakage: number; fabricated: number } | null;
    rawModelExcerpt: string | null;
    markersInMetadata: string[];
    markersInBody: string[];
  }

  const rows: Row[] = [];
  for (const { img, gold } of entries) {
    await page.setInputFiles('#file-input', `fixtures/${img.file}`);
    await expect
      .poll(async () => (await page.locator('#review-text').inputValue()).length, {
        timeout: 150_000,
        message: `${img.id}: deterministic result first`,
      })
      .toBeGreaterThan(0);
    await expect
      .poll(async () => page.locator('#llm-status').getAttribute('data-state'), {
        timeout: 300_000,
        message: `${img.id}: model cleanup settles`,
      })
      .toMatch(/^(applied|unavailable)$/);

    const debug = await readDebug(page);
    const reviewText = await page.locator('#review-text').inputValue();
    const goldBody = gold.body.join('\n');
    const ocrText = await page.locator('#raw-ocr-text').textContent({ timeout: 30_000 });

    // Safety invariants (must hold for every fixture, either mode):
    expect(['applied', 'unavailable']).toContain(debug.mode);
    expect(
      reviewText === (debug.mode === 'applied' ? debug.modelText : debug.deterministicText),
      `${img.id}: shown text must be the deterministic or validated model stage`,
    ).toBe(true);
    if (debug.mode === 'applied') {
      expect(debug.guardVerdict).toBe('pass');
    }

    const markers = gold.injection?.markers ?? [];
    const metadataShown = [debug.author ?? '', debug.tags.join(' '), debug.summary ?? '', debug.removedChrome.join(' ')].join(' ');
    const markersInMetadata = markers.filter((m) => metadataShown.toLowerCase().includes(m.toLowerCase()));
    const markersInBody = markers.filter((m) => reviewText.toLowerCase().includes(m.toLowerCase()));
    if (gold.kind === 'injection') {
      expect(markersInMetadata, `${img.id}: no attacker marker in shown metadata`).toEqual([]);
      expect(markersInBody.length, `${img.id}: the marker line is content and stays in the body`).toBe(markers.length);
    }

    rows.push({
      id: img.id,
      kind: gold.kind,
      mode: debug.mode,
      guardVerdict: debug.guardVerdict,
      attempts: debug.attempts,
      latencyMs: debug.latencyMs,
      baseline: {
        f1: bodyTokenF1(debug.deterministicText, goldBody),
        leakage: chromeLeakageRate(debug.deterministicText, goldBody, gold.chrome),
        fabricated: fabricatedTokenRate(debug.deterministicText, ocrText ?? ''),
      },
      model:
        debug.modelText !== null
          ? {
              f1: bodyTokenF1(debug.modelText, goldBody),
              leakage: chromeLeakageRate(debug.modelText, goldBody, gold.chrome),
              fabricated: fabricatedTokenRate(debug.modelText, ocrText ?? ''),
            }
          : null,
      rawModelExcerpt: debug.rawModelText ? debug.rawModelText.slice(0, 400) : null,
      markersInMetadata,
      markersInBody,
    });
    console.log(
      `eval ${img.id}: mode=${debug.mode} baseF1=${rows[rows.length - 1].baseline.f1.toFixed(3)} modelF1=${rows[rows.length - 1].model ? rows[rows.length - 1].model!.f1.toFixed(3) : 'n/a'} latencyMs=${debug.latencyMs}`,
    );

    // Back to the home screen for the next fixture (the review screen has
    // no file input; the opt-in toggle persists across Start over).
    if (img.id !== entries[entries.length - 1].img.id) {
      await page.getByRole('button', { name: 'Start over' }).click({ timeout: 30_000 });
      await page.locator('#llm-cleanup-toggle').waitFor({ timeout: 30_000 });
    }
  }

  // Aggregate + write the per-run evidence JSON (the committed copy comes
  // from the building host's final-evidence run of this same spec).
  const applied = rows.filter((r) => r.mode === 'applied');
  const standardRows = rows.filter((r) => r.kind !== 'injection');
  const mean = (xs: number[]) => (xs.length === 0 ? null : xs.reduce((a, b) => a + b, 0) / xs.length);
  const summary = {
    engine: browserName,
    fixtures: rows.length,
    appliedCount: applied.length,
    fallbackCount: rows.length - applied.length,
    baseline: {
      meanF1: mean(standardRows.map((r) => r.baseline.f1)),
      meanLeakage: mean(standardRows.map((r) => r.baseline.leakage)),
      meanFabricated: mean(standardRows.map((r) => r.baseline.fabricated)),
    },
    model: {
      meanF1: mean(standardRows.filter((r) => r.model).map((r) => r.model!.f1)),
      meanLeakage: mean(standardRows.filter((r) => r.model).map((r) => r.model!.leakage)),
      meanFabricated: mean(standardRows.filter((r) => r.model).map((r) => r.model!.fabricated)),
      meanLatencyMs: mean(applied.map((r) => r.latencyMs)),
    },
    rows,
  };
  const slug = browserName === 'chromium' ? 'chromium' : browserName;
  mkdirSync('docs/evidence/S4', { recursive: true });
  writeFileSync(`docs/evidence/S4/llm-eval-${slug}.json`, JSON.stringify(summary, null, 2) + '\n');
  console.log(`eval_llm summary: ${JSON.stringify({ ...summary, rows: rows.length }, null, 2)}`);
});
