import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MODEL_SERVER, startModelServer } from './helpers/model-server';
import { expectModelCachedExactly } from './helpers/model-cache';
import { PINNED_MODEL } from '../src/model/manifest';
import { runPrivacyAudit, startCapture } from './helpers/privacy';

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

test('a12_model_downloads_verifies_caches', async ({ page }) => {
  test.setTimeout(300_000); // real 397 MB download + streamed hashing + promote
  await startModelServer();
  const capture = startCapture(page);

  await page.goto(`/?testModelUrl=${MODEL_SERVER}/model-slow`);
  // R2-3: the download is opt-in behind the collapsed Advanced section.
  await page.locator('#advanced-model summary').click();
  await expect(page.locator('#model-download-btn')).toBeVisible();
  await page.locator('#model-download-btn').click();

  // Visible progress: the paced server guarantees the bar moves. A
  // MutationObserver records every REAL DOM state of the progress bar
  // (timer-based sampling starves while the streamed hash occupies the main
  // thread in WebKit; the observer runs in the same commit gaps React uses).
  const seen: number[] = await page.evaluate(async () => {
    const pcts: number[] = [];
    const record = () => {
      const bar = document.querySelector<HTMLElement>('#model-progress');
      const v = bar?.getAttribute('aria-valuenow');
      if (v !== null) pcts.push(Number(v));
    };
    const observer = new MutationObserver(record);
    observer.observe(document.body, { subtree: true, childList: true, attributes: true });
    record();
    const deadline = Date.now() + 120_000;
    while (Date.now() < deadline) {
      if (document.querySelector('#model-ready') || document.querySelector('#model-banner')) break;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    observer.disconnect();
    return pcts;
  });
  await expect(page.locator('#model-ready')).toBeVisible({ timeout: 30_000 });
  expect(
    seen.filter((p) => p > 0 && p < 100).length,
    `intermediate progress must be visible (saw ${JSON.stringify(seen)})`,
  ).toBeGreaterThan(0);

  // Cached: the model cache (OPFS or Cache Storage — per engine) holds
  // EXACTLY one entry with the pinned size; sha256 was verified before the
  // promote that moved the bytes there (the wrong-hash variant below proves
  // the gate fails closed).
  const cacheState = await expectModelCachedExactly(page);
  console.log(`a12: model cached via ${cacheState.backend} (${PINNED_MODEL.sizeBytes} bytes)`);

  // Privacy (A15 rules) with the model origin as the one designed exception:
  // only allow-listed storage exists; no post text anywhere (there is none in
  // this flow); nothing else may cross origins.
  const audit = await runPrivacyAudit(page, capture, [], [MODEL_SERVER]);
  expect(audit.violations, JSON.stringify(audit.violations, null, 2)).toEqual([]);
});

test('a12_interrupted_download_resumes', async ({ page }) => {
  test.setTimeout(300_000); // kill + resume of the real 397 MB file
  await startModelServer();

  // /model-kill-fresh destroys EVERY fresh (non-Range) request after ~25%:
  // the only way to `ready` is to resume from the received offset.
  await page.goto(`/?testModelUrl=${MODEL_SERVER}/model-kill-fresh`);
  await page.locator('#advanced-model summary').click(); // R2-3: opt-in section
  await page.locator('#model-download-btn').click();
  await expect(page.locator('#model-ready')).toBeVisible({ timeout: 120_000 });

  // Cached: the model cache (OPFS or Cache Storage — per engine) holds
  // EXACTLY one entry with the pinned size, and the server log proves the
  // resume happened at the wire (a Range request with a non-zero offset).
  await expectModelCachedExactly(page);

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
