import { test, expect } from '@playwright/test';
import { readPrecacheEntries, waitForAppShellReady } from './helpers/pwa';

/**
 * UC04 (A11, web platform — Chromium AND WebKit): the app is installable
 * (a valid manifest and a registered service worker, checked structurally —
 * the install prompt itself is browser chrome and not automatable), and
 * after the first load the app shell loads with the network disabled.
 *
 * The third testcase measures the stronger claim the plan's privacy section
 * cares about: with the shell precached (including /ocr-assets/), real OCR
 * also works offline. What is and is not cached is asserted, not assumed:
 * the precache list is the build's own manifest, and the offline reload
 * must produce ZERO failed requests (everything came from the SW).
 */

test('a11_installable_manifest_and_sw_registered', async ({ page }) => {
  await page.goto('/');

  // Structural installability: a valid manifest…
  const manifest = await page.evaluate(async () => await (await fetch('/manifest.webmanifest')).json());
  expect(manifest.name).toBe('PostClip');
  expect(manifest.start_url).toBe('/');
  expect(manifest.scope).toBe('/');
  expect(manifest.display).toBe('standalone');
  const icons: { src: string; sizes: string; type: string; purpose: string }[] = manifest.icons;
  expect(icons).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        src: '/icons/icon-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      }),
      expect.objectContaining({
        src: '/icons/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      }),
      expect.objectContaining({
        src: '/icons/icon-512-maskable.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      }),
    ]),
  );
  // …whose every icon actually downloads from the served build.
  for (const icon of icons) {
    const res = await page.evaluate(async (src) => {
      const r = await fetch(src);
      return { ok: r.ok, bytes: (await r.arrayBuffer()).byteLength };
    }, icon.src);
    expect(res.ok, `icon ${icon.src} must download`).toBe(true);
    expect(res.bytes, `icon ${icon.src} must be non-empty`).toBeGreaterThan(100);
  }
  // share_target is declared for this engine-independent manifest half of A08.
  expect(manifest.share_target?.action).toBe('/share-target');

  // …and a registered service worker with a COMPLETE precache.
  const state = await waitForAppShellReady(page);
  expect(state.manifestCount, 'the precache manifest lists entries').toBeGreaterThan(0);
  const entries = await readPrecacheEntries(page);
  for (const e of entries) {
    expect(e.url.startsWith('/'), `precache entry ${e.url} must be same-origin`).toBe(true);
  }
  // The OCR runtime is part of the offline shell (plan: the app-shell cache
  // covers /ocr-assets/ so first-load-then-offline works end to end).
  expect(
    entries.some((e) => e.url.startsWith('/ocr-assets/')),
    'the precache must cover /ocr-assets/',
  ).toBe(true);
});

test('a11_offline_reload_app_shell_loads', async ({ page }) => {
  await page.goto('/');
  await waitForAppShellReady(page);

  const failed: string[] = [];
  const served: { url: string; fromSW: boolean }[] = [];
  page.on('requestfailed', (r) => failed.push(r.url()));
  page.on('response', (r) => served.push({ url: r.url(), fromSW: r.fromServiceWorker() }));

  // After the first load, the network is disabled and the app shell must load.
  await page.context().setOffline(true);
  await page.reload();

  await expect(page.getByRole('heading', { name: 'PostClip' })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId('dropzone')).toBeVisible();
  expect(
    served.filter((r) => r.fromSW).length,
    'the shell must be served by the service worker while offline',
  ).toBeGreaterThan(0);
  expect(failed, 'no request may fail while the shell loads offline').toEqual([]);
});

test('a11_offline_ocr_after_first_load', async ({ page }) => {
  await page.goto('/');
  await waitForAppShellReady(page);

  const failed: string[] = [];
  page.on('requestfailed', (r) => failed.push(r.url()));

  await page.context().setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'PostClip' })).toBeVisible({ timeout: 60_000 });

  // With the shell (including /ocr-assets/) precached, a pick runs the FULL
  // pipeline offline: no network request fails, real OCR produces the review.
  await page.setInputFiles('#file-input', 'fixtures/images/clean01.png');
  await expect(page.getByRole('heading', { name: 'Review' })).toBeVisible({ timeout: 120_000 });
  await expect
    .poll(async () => (await page.locator('#review-text').inputValue()).length, {
      timeout: 120_000,
      message: 'real in-browser OCR to run entirely offline from the precached assets',
    })
    .toBeGreaterThan(40);
  expect(failed, 'the offline OCR flow must not need the network').toEqual([]);
});
