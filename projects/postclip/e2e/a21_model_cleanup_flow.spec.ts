import { test, expect, type Page } from '@playwright/test';
import { MODEL_SERVER, startModelServer } from './helpers/model-server';

/**
 * A21 (S4, web platform — Chromium AND WebKit): the pinned model runs
 * through the app in the browser (WASM path, headless Chromium on Linux)
 * and the review screen shows the verified, faithful cleaned text plus
 * optional suggested author/tags/summary; where the capability probe says
 * the browser cannot run it (measured on this Playwright WebKit build: the
 * 397 MB wasm load fails "unknown transient reason" — same engine-bug
 * family as the S3 OPFS finding), the app correctly falls back and says so.
 *
 * The flow is the real user path: the model is downloaded once (real
 * pinned file served locally), the user toggles "model cleanup" ON, picks
 * a fixture, and the app either applies the VALIDATED model cleanup or
 * shows the explicit unavailable flag — never unvalidated model text.
 */

/** Download the pinned model on this page and wait for `ready`. */
async function modelReady(page: Page) {
  await startModelServer();
  await page.goto(`/?testModelUrl=${MODEL_SERVER}/model`);
  await page.locator('#advanced-model summary').click(); // R2-3: opt-in section
  await page.locator('#model-download-btn').click();
  await expect(page.locator('#model-ready')).toBeVisible({ timeout: 240_000 });
}

async function spyNavigatorShare(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __shareCalls: unknown[] };
    w.__shareCalls = [];
    Object.defineProperty(navigator, 'share', {
      value: (data: ShareData) => {
        w.__shareCalls.push(data);
        return Promise.resolve();
      },
      configurable: true,
      writable: true,
    });
  });
}

test('a21_model_cleanup_flow_verified_result_or_visible_fallback', async ({ page, browserName }) => {
  test.setTimeout(420_000); // model download + wasm load + real inference
  await spyNavigatorShare(page);
  await modelReady(page);

  // Model cleanup is OFF by default: the toggle exists, unchecked.
  const toggle = page.locator('#llm-cleanup-toggle');
  await expect(toggle).toBeVisible();
  await expect(toggle).not.toBeChecked();

  await toggle.check();
  await page.setInputFiles('#file-input', 'fixtures/images/clean01.png');

  // The deterministic result shows first; the model upgrade lands after
  // the wasm inference (single-threaded: tens of seconds).
  await expect
    .poll(async () => (await page.locator('#review-text').inputValue()).length, { timeout: 150_000 })
    .toBeGreaterThan(0);

  // R2-1 (A33): on the result screen the model opt-in is reachable but
  // COLLAPSED inside #advanced-cleanup — never on the answer's path.
  await expect(page.locator('#advanced-cleanup')).toBeVisible();
  expect(await page.locator('#advanced-cleanup').getAttribute('open'), 'the advanced disclosure must render collapsed').toBeNull();

  await expect
    .poll(async () => page.locator('#llm-status').getAttribute('data-state'), {
      timeout: 300_000,
      message: 'model cleanup settles into applied or unavailable',
    })
    .toMatch(/^(applied|unavailable)$/);

  const state = await page.locator('#llm-status').getAttribute('data-state');
  const debug = await page.evaluate(() => (window as unknown as { __postclipLlmDebug?: unknown }).__postclipLlmDebug);
  expect(debug, 'the test-build debug record must exist in test builds').toBeDefined();

  if (state === 'applied') {
    // Chromium (measured): the real model ran, the guard passed, and the
    // review text IS the validated model output (never raw model text).
    const reviewText = await page.locator('#review-text').inputValue();
    const record = debug as { modelText: string; deterministicText: string };
    expect(reviewText).toBe(record.modelText);
    expect(reviewText.length).toBeGreaterThan(0);
    await expect(page.locator('#llm-status')).toContainText(/Model cleanup/i);
    // Suggestions: verified author chip + tags/summary present but their
    // payload toggles default OFF (plan point 5). A suggestion the guard
    // dropped (e.g. a summary with untraceable words) renders no toggle at
    // all — that is the fail-closed side of the same rule.
    const includeTags = page.locator('#llm-include-tags');
    if ((await includeTags.count()) > 0) {
      await expect(includeTags).not.toBeChecked();
    }
    const includeSummary = page.locator('#llm-include-summary');
    if ((await includeSummary.count()) > 0) {
      await expect(includeSummary).not.toBeChecked();
    }
    // The share payload (toggles off) is exactly the review text (A03).
    await page.locator('#share-btn').click();
    const shareCalls = await page.evaluate(() => (window as unknown as { __shareCalls: ShareData[] }).__shareCalls);
    expect(shareCalls).toHaveLength(1);
    expect(shareCalls[0].text).toBe(reviewText);
  } else {
    // WebKit (measured on this build): the wasm load cannot run the model;
    // the app must say so explicitly and keep the deterministic cleanup.
    await expect(page.locator('#llm-status')).toContainText(/couldn't|cannot|unavailable/i);
    const reviewText = await page.locator('#review-text').inputValue();
    const record = debug as { deterministicText: string; modelText: string | null };
    expect(reviewText).toBe(record.deterministicText);
    expect(record.modelText).toBeNull();
  }
  console.log(`a21 (${browserName}): model cleanup state = ${state}`);
});

test('a21_model_cleanup_off_by_default_payload_has_no_suggestions', async ({ page }) => {
  test.setTimeout(240_000);
  await modelReady(page);

  // OFF by default: the user never toggled it on.
  await expect(page.locator('#llm-cleanup-toggle')).not.toBeChecked();
  await page.setInputFiles('#file-input', 'fixtures/images/clean01.png');
  await expect
    .poll(async () => (await page.locator('#review-text').inputValue()).length, { timeout: 150_000 })
    .toBeGreaterThan(0);

  await expect(page.locator('#llm-status').getAttribute('data-state')).resolves.toBe('off');
  // No suggestion UI exists while the model path is off.
  await expect(page.locator('#llm-include-tags')).toHaveCount(0);
  await expect(page.locator('#llm-include-summary')).toHaveCount(0);
});

test('a21_without_a_ready_model_the_toggle_explains_and_falls_back', async ({ page }) => {
  // The capability-probe path (test-only override, A29-gated): a browser
  // that cannot run the model never offers the toggle — the app says so,
  // and the standard cleanup still works (UC09's promise).
  await page.goto('/?testProbe=unsupported');
  await expect(page.locator('#model-banner')).toBeVisible();
  await expect(page.locator('#llm-cleanup-toggle')).toHaveCount(0);
  await page.setInputFiles('#file-input', 'fixtures/images/clean01.png');
  await expect
    .poll(async () => (await page.locator('#review-text').inputValue()).length, { timeout: 150_000 })
    .toBeGreaterThan(0);
  await expect(page.locator('#llm-status').getAttribute('data-state')).resolves.toBe('off');
});
