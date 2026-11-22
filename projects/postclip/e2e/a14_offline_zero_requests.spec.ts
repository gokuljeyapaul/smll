import { test, expect } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { MODEL_SERVER, startModelServer } from './helpers/model-server';
import { formatNetworkLog, startNetworkLog } from './helpers/network';
import { waitForAppShellReady } from './helpers/pwa';
import { MODEL_CACHE_NAME, PINNED_MODEL } from '../src/model/manifest';

/**
 * UC14 (A14, web platform — Chromium AND WebKit): with the model cached,
 * processing a fixture with the network disabled succeeds and issues ZERO
 * network requests. The request log is asserted EMPTY under the documented
 * definition in e2e/helpers/network.ts (SW-served precache responses are
 * not network: the worker answered them, no byte left the machine).
 *
 * Processing in S3 is the OCR + deterministic-cleanup pipeline (the model
 * is downloaded and cached but consumed by the S4 runtime); the flow also
 * re-verifies A02's pick path offline, in both engines.
 */
test('a14_offline_processing_zero_network_requests', async ({ page }) => {
  await startModelServer();

  // Online first: download the pinned model and let the shell precache.
  await page.goto(`/?testModelUrl=${MODEL_SERVER}/model`);
  await page.locator('#model-download-btn').click();
  await expect(page.locator('#model-ready')).toBeVisible({ timeout: 120_000 });

  const cachedBytes = await page.evaluate(
    async ({ cacheName, url }) => {
      const cache = await caches.open(cacheName);
      const res = await cache.match(url);
      return res ? (await res.blob()).size : null;
    },
    { cacheName: MODEL_CACHE_NAME, url: `${MODEL_SERVER}/model` },
  );
  expect(cachedBytes, 'the cached model must be the exact pinned size').toBe(PINNED_MODEL.sizeBytes);

  // The request log covers everything from here: offline reload + processing.
  const net = startNetworkLog(page);

  await page.context().setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'PostClip' })).toBeVisible({ timeout: 60_000 });
  await waitForAppShellReady(page);

  // The cached model is found OFFLINE by reading Cache Storage only —
  // ready, zero fetches (any fetch would also be a failed request below).
  await expect(page.locator('#model-ready')).toBeVisible();

  // Process a fixture with the network disabled: the SW serves the shell
  // (incl. /ocr-assets/), the model comes from the cache, cleanup is the
  // deterministic path — the review appears with real OCR text.
  await page.setInputFiles('#file-input', 'fixtures/images/clean01.png');
  await expect(page.getByRole('heading', { name: 'Review' })).toBeVisible({ timeout: 120_000 });
  await expect
    .poll(async () => (await page.locator('#review-text').inputValue()).length, {
      timeout: 120_000,
      message: 'real offline OCR + cleanup produce review text',
    })
    .toBeGreaterThan(40);
  await expect(page.locator('#cleanup-mode')).toContainText('Tidy-up model ready');

  const log = await net.flush();
  const block = formatNetworkLog(
    log,
    'A14 offline request log — processing a fixture with the model cached and the network disabled',
  );
  writeFileSync(join(process.cwd(), 'artifacts', 'offline-request-log.txt'), block);
  console.log(`\n${block}`);

  expect(
    log.networkRequests.map((r) => `${r.method} ${r.url}`),
    'ZERO network requests while the model is cached and offline (SW-served is not network)',
  ).toEqual([]);
  expect(log.swServedCount, 'the offline shell + OCR assets came from the service worker').toBeGreaterThan(0);
});
