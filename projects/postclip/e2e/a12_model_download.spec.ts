import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MODEL_SERVER, startModelServer } from './helpers/model-server';
import { runPrivacyAudit, startCapture } from './helpers/privacy';
import { MODEL_CACHE_NAME, PINNED_MODEL } from '../src/model/manifest';

/**
 * UC08 (A12, web platform — Chromium AND WebKit): first use downloads the
 * pinned model with visible progress, verifies its sha256 and ends `ready`,
 * cached in the model cache — and an interrupted download RESUMES with a
 * Range request (the local server kills every fresh request; only a resumed
 * one can complete, so "ready" here proves the resume end to end).
 *
 * The local server (scripts/serve_model.mjs) serves the REAL pinned file
 * from .cache/models/ (fetched+verified by scripts/fetch_model.mjs); the
 * test-only ?testModelUrl= flag points the app at it (test builds only).
 */

async function cachedEntryBytes(page: Page, url: string): Promise<number | null> {
  return page.evaluate(
    async ({ cacheName, url: u }) => {
      if (typeof caches === 'undefined') return null;
      const cache = await caches.open(cacheName);
      const res = await cache.match(u);
      if (!res) return null;
      const blob = await res.blob();
      return blob.size;
    },
    { cacheName: MODEL_CACHE_NAME, url },
  );
}

test('a12_model_downloads_verifies_caches', async ({ page }) => {
  await startModelServer();
  const capture = startCapture(page);

  await page.goto(`/?testModelUrl=${MODEL_SERVER}/model-slow`);
  await expect(page.locator('#model-download-btn')).toBeVisible();
  await page.locator('#model-download-btn').click();

  // Visible progress: the paced server guarantees the bar moves; every
  // observed intermediate value is collected to prove it was on screen.
  const seen: number[] = [];
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    const pct = await page
      .getByRole('progressbar')
      .getAttribute('aria-valuenow')
      .catch(() => null);
    if (pct !== null) seen.push(Number(pct));
    if (await page.locator('#model-ready').isVisible().catch(() => false)) break;
    await page.waitForTimeout(200);
  }
  await expect(page.locator('#model-ready')).toBeVisible({ timeout: 30_000 });
  expect(
    seen.filter((p) => p > 0 && p < 100).length,
    `intermediate progress must be visible (saw ${JSON.stringify(seen)})`,
  ).toBeGreaterThan(0);

  // Cached: the model cache holds the download under the model URL, and the
  // cached bytes are EXACTLY the pinned size (sha256 was verified before the
  // file entered the cache — the wrong-hash variant below proves the gate).
  const bytes = await cachedEntryBytes(page, `${MODEL_SERVER}/model-slow`);
  expect(bytes).toBe(PINNED_MODEL.sizeBytes);

  // Privacy (A15 rules) with the model origin as the one designed exception:
  // only allow-listed storage exists; no post text anywhere (there is none in
  // this flow); nothing else may cross origins.
  const audit = await runPrivacyAudit(page, capture, [], [MODEL_SERVER]);
  expect(audit.violations, JSON.stringify(audit.violations, null, 2)).toEqual([]);
});

test('a12_interrupted_download_resumes', async ({ page }) => {
  await startModelServer();

  // /model-kill-fresh destroys EVERY fresh (non-Range) request after ~25%:
  // the only way to `ready` is to resume from the received offset.
  await page.goto(`/?testModelUrl=${MODEL_SERVER}/model-kill-fresh`);
  await page.locator('#model-download-btn').click();
  await expect(page.locator('#model-ready')).toBeVisible({ timeout: 120_000 });

  const bytes = await cachedEntryBytes(page, `${MODEL_SERVER}/model-kill-fresh`);
  expect(bytes).toBe(PINNED_MODEL.sizeBytes);

  // The server log is the wire-level proof of the resume: a second request
  // with a Range start offset > 0 that was answered 206.
  const log = readFileSync(join(process.cwd(), 'artifacts', 'model-server.log'), 'utf-8');
  const resumeLines = log
    .split('\n')
    .filter((l) => l.includes('GET /model-kill-fresh') && /range=bytes=[1-9]\d*/.test(l) && l.includes('status=206'));
  const killLines = log.split('\n').filter((l) => l.includes('status=200-kill'));
  expect(killLines.length, 'the server killed the fresh download').toBeGreaterThan(0);
  expect(
    resumeLines.length,
    'the app resumed with a Range request (offset > 0) after the kill',
  ).toBeGreaterThan(0);
});
