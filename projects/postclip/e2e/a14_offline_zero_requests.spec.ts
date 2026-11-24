import { test, expect } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { MODEL_SERVER, startModelServer } from './helpers/model-server';
import { expectModelCachedExactly } from './helpers/model-cache';
import { formatNetworkLog, startNetworkLog } from './helpers/network';
import { waitForAppShellReady } from './helpers/pwa';

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
  test.setTimeout(600_000); // real download + offline OCR; generous for CI variance
  await startModelServer();

  // Online first: let the service worker finish its COMPLETE precache
  // BEFORE any download or offline step (going offline mid-install would
  // fail the install and leave no shell to serve).
  await page.goto(`/?testModelUrl=${MODEL_SERVER}/model`);
  const shell = await waitForAppShellReady(page);
  const precacheEntries = shell.manifestCount;

  // Download the pinned model with the shell already ready.
  // 480 s: the assertion is unchanged (the model must reach ready); the wait
  // absorbs CI-environment variance that a 120 s budget flaked on (attempt 2
  // of PR #67's CI stalled past 120 s on a run where a13's full 396 MB
  // wrong-hash download+hash completed in 13 s).
  await page.locator('#model-download-btn').click();
  await expect(page.locator('#model-ready')).toBeVisible({ timeout: 480_000 });

  // The cached model is verified-and-cached (exactly one entry, pinned size,
  // in whichever backend this engine uses) BEFORE going offline.
  const cacheState = await expectModelCachedExactly(page);
  console.log(`a14: model cached via ${cacheState.backend}`);

  // The request log covers everything from here: offline reload + processing.
  const net = startNetworkLog(page);

  await page.context().setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'PostClip' })).toBeVisible({ timeout: 60_000 });

  // The offline shell is complete and worker-served, asserted WITHOUT any
  // network fetch: the app-shell cache still holds every entry the online
  // precache manifest listed (captured above), and the worker is active.
  // (The S2 helper fetches /precache-manifest.js, which is fine online but
  // is not itself a precache key — offline it would be a network fetch.)
  await expect
    .poll(
      async () =>
        page.evaluate(async () => {
          const names = await caches.keys();
          const shellName = names.find((n) => n.startsWith('precache'));
          const cached = shellName ? (await (await caches.open(shellName)).keys()).length : -1;
          const reg = await navigator.serviceWorker.getRegistration();
          return { cached, active: !!reg?.active };
        }),
      { timeout: 120_000, message: 'the complete app shell is served offline from the worker' },
    )
    .toEqual({ cached: precacheEntries, active: true });

  // The cached model is found OFFLINE by reading Cache Storage only —
  // ready, zero fetches (any fetch would also be a failed request below).
  await expect(page.locator('#model-ready')).toBeVisible();

  // Process a fixture with the network disabled: the SW serves the shell
  // (incl. /ocr-assets/), the model comes from the cache, cleanup is the
  // deterministic path — the review appears with real OCR text.
  await page.setInputFiles('#file-input', 'fixtures/images/clean01.png');
  await expect(page.getByRole('heading', { name: 'Your text' })).toBeVisible({ timeout: 120_000 });
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
