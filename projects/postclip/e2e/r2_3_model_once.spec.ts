import { test, expect, type Page } from '@playwright/test';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, webkit } from '@playwright/test';
import { MODEL_SERVER, startModelServer } from './helpers/model-server';
import { PINNED_MODEL } from '../src/model/manifest';
import { startNetworkLog } from './helpers/network';
import { readModelCacheState } from './helpers/model-cache';

/**
 * R2-3 (issue #78, plan S9): the model downloads ONCE and survives.
 *
 * A37 — a real download in a PERSISTENT profile, then:
 *   - reload: the cached model is found by the CHEAP check (size + the
 *     recorded sha256 marker), `ready (cached)` is shown, no download
 *     button, ZERO model network requests;
 *   - a full same-profile browser restart (the context is closed and a new
 *     browser launched on the SAME profile dir): same result — the model
 *     is remembered, nothing re-downloads;
 *   - navigator.storage.persist() is requested at the download (the
 *     user's opt-in — the click), NEVER silently at load (spy-pinned).
 *
 * A39 — the volatile-storage case (the storage reports it cannot keep the
 * model): the kind explanation, NO download offer, and the standard
 * rules cleanup keeps working end to end.
 *
 * A40 — the download is opt-in behind a collapsed "Advanced: optional
 * tidy-up model" section on the home screen; nothing about the model is
 * pushed at the user by default.
 *
 * The persistent-vs-ephemeral scenario table (numbers) is recorded to
 * docs/evidence/R2-3/scenario-table.json by these tests.
 */

const BASE = 'http://localhost:4173';
const EV = 'docs/evidence/R2-3';
const MARKER_KEY = `model-${PINNED_MODEL.sha256}.verified.json`;

/** Track the app's persist-request diagnostics (console, counted NODE-side —
 * no evaluate races). The manager emits `persist() requested at the download
 * opt-in` exactly when it CALLS navigator.storage.persist() (and
 * `persist() unavailable` when the browser has none) — the spy-on-API
 * approach is defeated by some engines' non-writable StorageManager; the
 * app's own diagnostic is not. */
function trackPersistRequests(page: Page): { count: () => number } {
  let n = 0;
  page.on('console', (msg) => {
    if (msg.text().includes('persist() requested at the download opt-in')) n += 1;
  });
  return { count: () => n };
}

/** Is the verified sha256 marker present in the model cache? */
async function markerPresent(page: Page): Promise<boolean> {
  return page.evaluate(async (markerKey) => {
    try {
      const root = await navigator.storage.getDirectory();
      const dir = await root.getDirectoryHandle('postclip-model');
      const fh = await dir.getFileHandle(markerKey);
      return (await (await fh.getFile()).size) > 0;
    } catch {
      // fall through to Cache Storage (the WebKit backend)
    }
    try {
      const names = await caches.keys();
      const modelName = names.find((n) => n.startsWith('postclip-model'));
      if (!modelName) return false;
      const hit = await (await caches.open(modelName)).match(markerKey);
      return !!hit;
    } catch {
      return false;
    }
  }, MARKER_KEY);
}

interface ScenarioRow {
  scenario: string;
  engine: string;
  model_bytes: number | null;
  marker_present: boolean;
  ui_state: string;
  model_network_requests: number;
}

function appendScenarioRow(row: ScenarioRow): void {
  mkdirSync(EV, { recursive: true });
  let rows: ScenarioRow[] = [];
  try {
    rows = JSON.parse(readFileSync(join(EV, 'scenario-table.json'), 'utf-8')) as ScenarioRow[];
  } catch {
    rows = [];
  }
  rows.push(row);
  writeFileSync(join(EV, 'scenario-table.json'), JSON.stringify(rows, null, 2) + '\n');
}

/** Bytes of the cached model entry in this page's model store (null = absent). */
async function cachedModelBytes(page: Page): Promise<number | null> {
  const state = await readModelCacheState(page);
  return state.opfsEntryBytes ?? state.cacheStorageEntryBytes;
}

function engineFor(browserName: string): typeof chromium {
  return browserName === 'webkit' ? webkit : chromium;
}

test('a37_model_downloads_once_survives_reload_and_same_profile_restart', async ({
  browserName,
}) => {
  test.setTimeout(600_000); // one real download + reload + a full relaunch
  await startModelServer();

  // A REAL persistent profile: closing this browser and relaunching on the
  // same dir is the "close and reopen a context that reuses the same
  // profile" scenario from issue #78.
  const profileDir = mkdtempSync(join(tmpdir(), 'postclip-a37-profile-'));
  const engine = engineFor(browserName);
  const ctx = await engine.launchPersistentContext(profileDir, {
    recordVideo: { dir: join('test-results', `a37-${browserName}`) },
  });
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  const persistRequests = trackPersistRequests(page);

  await page.goto(`${BASE}/?testModelUrl=${MODEL_SERVER}/model`);

  // The download is opt-in, behind the collapsed Advanced section (A40).
  await expect(page.locator('#advanced-model')).toBeVisible();
  expect(await page.locator('#advanced-model').getAttribute('open'), 'collapsed by default').toBeNull();
  // NEVER silently at load: persist() has not been requested yet.
  expect(persistRequests.count(), 'persist() must not be requested at load').toBe(0);

  // The user opts in: open the Advanced section, download.
  await page.locator('#advanced-model summary').click();
  await expect(page.locator('#model-download-btn')).toBeVisible();
  await page.locator('#model-download-btn').click();
  // The opt-in moment: persist() is requested with the download.
  await expect
    .poll(() => persistRequests.count(), { timeout: 60_000 })
    .toBeGreaterThanOrEqual(1);

  await expect(page.locator('#model-ready')).toBeVisible({ timeout: 300_000 });
  await expect(page.locator('#model-ready')).toContainText('ready (cached)');
  expect(await markerPresent(page), 'the verified sha256 marker is recorded').toBe(true);
  const afterDownload = await cachedModelBytes(page);
  expect(afterDownload).toBe(PINNED_MODEL.sizeBytes);

  // --- reload: the cached model is found CHEAPLY, no re-download ----------
  const netReload = startNetworkLog(page);
  await page.reload();
  await expect(page.locator('#model-ready')).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('#model-ready')).toContainText('ready (cached)');
  await expect(page.locator('#model-download-btn')).toHaveCount(0);
  const reloadLog = await netReload.flush();
  const reloadModelRequests = reloadLog.networkRequests.filter(
    (r) => r.url.includes(MODEL_SERVER) || r.url.includes('huggingface.co'),
  );
  expect(
    reloadModelRequests,
    `reload must make ZERO model network requests (saw ${JSON.stringify(reloadModelRequests)})`,
  ).toEqual([]);
  appendScenarioRow({
    scenario: 'reload after download (same context)',
    engine: browserName,
    model_bytes: await cachedModelBytes(page),
    marker_present: await markerPresent(page),
    ui_state: 'ready (cached), no download button',
    model_network_requests: reloadModelRequests.length,
  });

  // --- same-profile restart: close the browser, relaunch on the dir ------
  await ctx.close();
  const ctx2 = await engine.launchPersistentContext(profileDir, {
    recordVideo: { dir: join('test-results', `a37-restart-${browserName}`) },
  });
  const page2 = ctx2.pages()[0] ?? (await ctx2.newPage());
  const persistRequests2 = trackPersistRequests(page2);
  const netRestart = startNetworkLog(page2);
  await page2.goto(`${BASE}/?testModelUrl=${MODEL_SERVER}/model`);
  expect(persistRequests2.count(), 'no persist() at load after restart either').toBe(0);
  await expect(page2.locator('#model-ready')).toBeVisible({ timeout: 60_000 });
  await expect(page2.locator('#model-ready')).toContainText('ready (cached)');
  await expect(page2.locator('#model-download-btn')).toHaveCount(0);
  expect(await markerPresent(page2), 'the marker survived the restart with the model').toBe(true);
  expect(await cachedModelBytes(page2)).toBe(PINNED_MODEL.sizeBytes);
  const restartLog = await netRestart.flush();
  const restartModelRequests = restartLog.networkRequests.filter(
    (r) => r.url.includes(MODEL_SERVER) || r.url.includes('huggingface.co'),
  );
  expect(
    restartModelRequests,
    `the restart must make ZERO model network requests (saw ${JSON.stringify(restartModelRequests)})`,
  ).toEqual([]);
  appendScenarioRow({
    scenario: 'same-profile browser restart (close + relaunch, same dir)',
    engine: browserName,
    model_bytes: await cachedModelBytes(page2),
    marker_present: await markerPresent(page2),
    ui_state: 'ready (cached), no download button',
    model_network_requests: restartModelRequests.length,
  });
  await ctx2.close();
});

test('a39_volatile_storage_shows_kind_explanation_and_no_download', async ({ page, browserName }) => {
  test.setTimeout(240_000);
  await startModelServer();

  // The volatile-storage signal (test-build override): the storage
  // reports it cannot keep the model. The app must say so once, plainly,
  // and NOT offer the 397 MB download — the rules cleanup is the default.
  await page.goto(`/?testStorage=volatile&testModelUrl=${MODEL_SERVER}/model`);
  await expect(page.locator('#advanced-model')).toBeVisible();
  await page.locator('#advanced-model summary').click();

  await expect(page.locator('#model-banner')).toBeVisible();
  await expect(page.locator('#model-banner')).toContainText("clears the tidy-up model's storage");
  await expect(page.locator('#model-banner')).toContainText('Everything else still works');
  await expect(page.locator('#model-download-btn')).toHaveCount(0);

  // Everything else still works: the standard rules cleanup end to end.
  await page.setInputFiles('#file-input', 'fixtures/images/clean01.png');
  await expect(page.getByRole('heading', { name: 'Your text' })).toBeVisible({ timeout: 150_000 });
  await expect
    .poll(async () => (await page.locator('#review-text').inputValue()).length, {
      timeout: 150_000,
      message: 'real OCR + the standard rules cleanup produce the result text',
    })
    .toBeGreaterThan(40);
  appendScenarioRow({
    scenario: 'volatile storage (the storage cannot keep the model)',
    engine: browserName,
    model_bytes: await cachedModelBytes(page),
    marker_present: await markerPresent(page),
    ui_state: 'kind explanation, no download offered; rules cleanup works',
    model_network_requests: 0,
  });
});

test('a39_no_room_refuses_the_download_before_any_byte_is_fetched', async ({ page, browserName }) => {
  test.setTimeout(120_000);
  await startModelServer();

  // The estimate reports less room than the download needs (temp + final
  // during the promote): the app refuses with the kind no-room message
  // and fetches ZERO model bytes.
  await page.goto(`/?testStorage=no-room&testModelUrl=${MODEL_SERVER}/model`);
  await expect(page.locator('#advanced-model')).toBeVisible();
  await page.locator('#advanced-model summary').click();
  await expect(page.locator('#model-download-btn')).toBeVisible();
  const net = startNetworkLog(page);
  await page.locator('#model-download-btn').click();
  await expect(page.locator('#model-banner')).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('#model-banner')).toContainText("isn't enough room");
  await expect(page.locator('#model-banner')).toContainText('Everything else still works');
  const log = await net.flush();
  expect(
    log.networkRequests.filter((r) => r.url.includes(MODEL_SERVER) || r.url.includes('huggingface.co')),
    'no model byte may be fetched when there is no room',
  ).toEqual([]);
  appendScenarioRow({
    scenario: 'not enough room (estimate below the bar)',
    engine: browserName,
    model_bytes: await cachedModelBytes(page),
    marker_present: await markerPresent(page),
    ui_state: 'kind no-room refusal, zero model bytes fetched',
    model_network_requests: 0,
  });
});

test('a40_download_is_opt_in_behind_the_advanced_section', async ({ page }) => {
  test.setTimeout(120_000);

  // The home screen never pushes the model: the download lives only inside
  // the collapsed "Advanced: optional tidy-up model" section.
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'PostClip' })).toBeVisible();
  await expect(page.locator('#advanced-model')).toBeVisible();
  await expect(page.locator('#advanced-model summary')).toContainText('Advanced: optional tidy-up model');
  expect(await page.locator('#advanced-model').getAttribute('open'), 'collapsed by default').toBeNull();
  // Nothing about the model is offered by default: the button is hidden
  // until the user opens the section.
  await expect(page.locator('#model-download-btn')).toBeHidden();
  await page.locator('#advanced-model summary').click();
  await expect(page.locator('#model-download-btn')).toBeVisible();
  // The main flow's furniture is unchanged and above the section.
  await expect(page.locator('#file-input')).toBeAttached();
  await expect(page.getByTestId('dropzone')).toBeVisible();
});

test('a40_fresh_profile_records_the_model_absent_honestly', async ({ browserName }) => {
  test.setTimeout(120_000);

  // A brand-new profile (what a WebView that wipes storage, or a private
  // window, effectively is at every launch): the model is honestly
  // absent and the opt-in offer is the only honest thing to show — this
  // records the LOST row of the scenario table with numbers.
  const profileDir = mkdtempSync(join(tmpdir(), 'postclip-a40-fresh-'));
  const ctx = await engineFor(browserName).launchPersistentContext(profileDir, {
    recordVideo: { dir: join('test-results', `a40-fresh-${browserName}`) },
  });
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  await page.goto(`${BASE}/`);
  await expect(page.locator('#advanced-model')).toBeVisible();
  await page.locator('#advanced-model summary').click();
  await expect(page.locator('#model-download-btn')).toBeVisible(); // the honest offer
  await expect(page.locator('#model-ready')).toHaveCount(0);
  appendScenarioRow({
    scenario: 'fresh profile (nothing persisted — private-window equivalent)',
    engine: browserName,
    model_bytes: await cachedModelBytes(page),
    marker_present: await markerPresent(page),
    ui_state: 'honestly absent; the opt-in offer inside the Advanced section',
    model_network_requests: 0,
  });
  await ctx.close();
});
