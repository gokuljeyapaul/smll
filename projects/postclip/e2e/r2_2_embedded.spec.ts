import { expect, test } from '@playwright/test';
import {
  APP_ORIGIN,
  HOST_ORIGIN_ALLOWED,
  HOST_ORIGIN_STRANGER,
  startHostServer,
  stopHostServer,
} from './helpers/host-server';

/**
 * R2-2 (A43 + A45, issue #79): PostClip as a component inside a host app.
 * The host test page (e2e/fixtures/host/host.html) is served by a SECOND
 * local server on a DIFFERENT origin from the app's; it embeds PostClip in
 * a cross-origin iframe and talks through the postMessage contract.
 *
 *   a43 — the app runs correctly inside the frame (the pick flow works
 *         in-frame; no top-level assumptions; console stays clean), and
 *         where the frame blocks clipboard-write WITHOUT an allow= policy
 *         the Copy button falls back and SAYS SO — never a silent failure.
 *   a45 — the cross-origin round trip: load-image → real OCR → result,
 *         postclip:ready on boot, the reply's origin asserted, a message
 *         from a non-allow-listed origin ignored, and no post text in any
 *         URL or storage on either side.
 */

test.beforeAll(async () => {
  await startHostServer();
});
test.afterAll(async () => {
  await stopHostServer();
});

/** The host page URL: `allow` is what the app allow-lists; the page's own
 *  origin is what sends. Same origin → accepted; stranger origin → ignored. */
function hostUrl(senderOrigin: string, allow: string, frameAllow?: string): string {
  const params = new URLSearchParams({
    app: APP_ORIGIN,
    allow,
  });
  if (frameAllow !== undefined) params.set('frameallow', frameAllow);
  return `${senderOrigin}/host.html?${params.toString()}`;
}

const FRAME = '#postclip-frame';

test('a43_app_runs_inside_cross_origin_iframe_pick_flow_works_in_frame', async ({ page }) => {
  test.setTimeout(300_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${String(e)}`));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(hostUrl(HOST_ORIGIN_ALLOWED, HOST_ORIGIN_ALLOWED));

  const app = page.frameLocator(FRAME);
  // The app boots inside the frame — home screen, primary action visible.
  await expect(app.getByRole('button', { name: 'Choose screenshot' })).toBeVisible({
    timeout: 60_000,
  });

  // The pick flow works INSIDE the frame, through the real in-browser OCR.
  await app.locator('#file-input').setInputFiles('fixtures/images/clean01.png');
  await expect(app.getByRole('heading', { name: 'Your text' })).toBeVisible({
    timeout: 180_000,
  });
  await expect
    .poll(async () => (await app.locator('#review-text').inputValue()).length, {
      timeout: 60_000,
      message: 'real OCR produced the result text inside the frame',
    })
    .toBeGreaterThan(40);
  await expect(app.locator('#copy-btn')).toBeVisible();

  // Nothing assumed a top-level page: the host page saw no page errors.
  expect(errors, `no page errors on the embedding host page: ${errors.join(' | ')}`).toEqual([]);
});

test('a43_copy_in_frame_without_clipboard_allow_falls_back_and_says_so', async ({ page }) => {
  test.setTimeout(300_000);
  const isChromium = test.info().project.name === 'chromium';
  await page.setViewportSize({ width: 390, height: 844 });
  // No frameallow param → the iframe has NO allow= policy, so the frame
  // blocks clipboard-write (the issue's exact example).
  await page.goto(hostUrl(HOST_ORIGIN_ALLOWED, HOST_ORIGIN_ALLOWED));

  const app = page.frameLocator(FRAME);
  await app.locator('#file-input').setInputFiles('fixtures/images/clean01.png');
  await expect(app.getByRole('heading', { name: 'Your text' })).toBeVisible({
    timeout: 180_000,
  });
  // Determinism (the Review screen renders during READING too — the heading
  // alone is not the result): wait for the actual result text before acting,
  // so the Copy click cannot race a mid-read text change that clears the
  // banner.
  await expect
    .poll(async () => (await app.locator('#review-text').inputValue()).length, {
      timeout: 120_000,
      message: 'the real OCR result is in the text box before the Copy click',
    })
    .toBeGreaterThan(40);

  await app.locator('#copy-btn').click();
  const banner = app.locator('.error-banner');
  const copied = app.locator('.copied-note');

  if (isChromium) {
    // Chromium blocks in-frame clipboard-write without the allow= policy:
    // the button MUST say so, specifically and kindly (never silently).
    await expect(banner).toBeVisible({ timeout: 20_000 });
    await expect(banner).toContainText('blocked');
    await expect(banner).toContainText('copy it yourself');
    await expect(copied).toHaveCount(0);
  } else {
    // WebKit's in-frame clipboard behavior is not reliably blockable here
    // (the repo's existing WebKit clipboard policy: attempt and record).
    // The invariant that must hold on BOTH engines: NO silent failure —
    // clicking Copy always produces a visible outcome.
    await expect
      .poll(
        async () => (await banner.count()) + (await copied.count()),
        { timeout: 20_000, message: 'Copy produced a visible outcome (copied or explained)' },
      )
      .toBeGreaterThan(0);
  }
});

test('a45_cross_origin_host_round_trip_load_image_to_result', async ({ page }) => {
  test.setTimeout(360_000);
  await page.setViewportSize({ width: 390, height: 844 });
  const urlBefore = hostUrl(HOST_ORIGIN_ALLOWED, HOST_ORIGIN_ALLOWED);
  await page.goto(urlBefore);

  // The app announces itself to the allow-listed origin on boot.
  const readyLi = page.locator('#host-log li[data-type="postclip:ready"]');
  await expect(readyLi).toBeVisible({ timeout: 60_000 });
  await expect(readyLi).toHaveAttribute('data-origin', APP_ORIGIN);

  // host → PostClip: hand the screenshot over.
  await page.locator('#send-btn').click();

  // PostClip → host: the result comes back (real OCR ran inside the app).
  const resultText = page.locator('#result-text');
  await expect(resultText).toBeVisible({ timeout: 240_000 });
  await expect
    .poll(async () => (await resultText.textContent())?.length ?? 0, {
      timeout: 60_000,
      message: 'the round-trip result text is real OCR output',
    })
    .toBeGreaterThan(40);

  // The reply's origin is exactly the app's origin (recorded per message).
  const replies = page.locator('#host-log li');
  const count = await replies.count();
  expect(count, 'the host received ready + result').toBeGreaterThanOrEqual(2);
  for (let i = 0; i < count; i++) {
    expect(await replies.nth(i).getAttribute('data-origin')).toBe(APP_ORIGIN);
  }

  // Privacy on BOTH sides of the contract: no post text in any URL or
  // storage (the demo host keeps the text in the DOM only — that is the
  // feature — and the app stores nothing, as always).
  expect(page.url(), 'the host page URL is unchanged').toBe(urlBefore);
  const hostStorage = await page.evaluate(() => ({
    local: localStorage.length,
    session: sessionStorage.length,
  }));
  expect(hostStorage.local, 'the host page stored nothing').toBe(0);
  expect(hostStorage.session, 'the host page stored nothing (session)').toBe(0);
  const appFrame = page.frames().find((f) => f.url().startsWith(APP_ORIGIN));
  expect(appFrame, 'the embedded app frame is reachable').toBeTruthy();
  const appStorage = await appFrame!.evaluate(() => ({
    local: localStorage.length,
    session: sessionStorage.length,
  }));
  expect(appStorage.local, 'the embedded app stored nothing').toBe(0);
  expect(appStorage.session, 'the embedded app stored nothing (session)').toBe(0);
});

test('a45_message_from_non_allowlisted_origin_is_ignored', async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 390, height: 844 });
  // The page is served at the STRANGER origin (127.0.0.1:4199) but the
  // app allow-lists localhost:4199 — so this page's messages come from a
  // non-allow-listed origin and must be ignored (no ready, no reading, no
  // result; and the app never replies to an untrusted origin at all).
  await page.goto(hostUrl(HOST_ORIGIN_STRANGER, HOST_ORIGIN_ALLOWED));

  const app = page.frameLocator(FRAME);
  await expect(app.getByRole('button', { name: 'Choose screenshot' })).toBeVisible({
    timeout: 60_000,
  });

  await page.locator('#send-btn').click();

  // For 5 seconds the app must NOT start reading (a message that slipped
  // through would show the reading state within moments)…
  await page.waitForTimeout(5_000);
  await expect(app.getByTestId('dropzone'), 'the home screen is untouched').toBeVisible();
  await expect(app.getByTestId('reading-progress')).toHaveCount(0);
  await expect(app.getByRole('heading', { name: 'Your text' })).toHaveCount(0);

  // …and the non-allow-listed sender received NOTHING back (no ready, no
  // result, no error — an untrusted origin is never replied to).
  await page.waitForTimeout(3_000);
  const logged = await page.locator('#host-log li').count();
  expect(logged, 'messages from a non-allow-listed origin are ignored, never answered').toBe(0);
});
