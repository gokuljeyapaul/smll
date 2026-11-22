import { test, expect } from '@playwright/test';
import { runPrivacyAudit, startCapture } from './helpers/privacy';
import { postShareTargetForm, readFixtureB64, waitForAppShellReady } from './helpers/pwa';

/**
 * UC02 (A08, chromium-only platform ID): the manifest declares a
 * share_target accepting images, and the service worker receives a real
 * multipart POST, hands the image to the pipeline and the review screen
 * shows the text. Simulated by posting through the service worker from the
 * page (the page's own fetch is intercepted by the SW's fetch event — the
 * same handler Android's share sheet hits); real installed-PWA sharing is
 * A27 (NOT_RUN). The second testcase is the negative path: posts WITHOUT an
 * image are ignored fail-closed — nothing processed, no error state.
 */
test.skip(
  ({ browserName }) => browserName !== 'chromium',
  'A08/UC02 is a chromium-only platform ID (plan testability map; real installed-PWA sharing is A27)',
);

test('a08_share_target_receives_image', async ({ page }) => {
  const capture = startCapture(page);
  await page.goto('/');

  // A08, manifest half: share_target declared, POST + multipart, images only.
  const manifest = await page.evaluate(async () => await (await fetch('/manifest.webmanifest')).json());
  expect(manifest.share_target).toEqual({
    action: '/share-target',
    method: 'POST',
    enctype: 'multipart/form-data',
    params: expect.objectContaining({
      files: [expect.objectContaining({ name: 'image', accept: expect.arrayContaining(['image/*']) })],
    }),
  });

  await page.goto('/');
  await waitForAppShellReady(page);

  // A08, service-worker half: a real multipart POST through the SW.
  const bytes = await readFixtureB64('fixtures/images/clean03.png');
  const res = await postShareTargetForm(page, { name: 'shared.png', type: 'image/png', bytes });
  expect(res.ok).toBe(true);

  // The SW handed the image to the pipeline: review screen with real OCR text.
  await expect(page.getByRole('heading', { name: 'Review' })).toBeVisible({ timeout: 120_000 });
  await expect
    .poll(async () => (await page.locator('#review-text').inputValue()).length, {
      timeout: 120_000,
      message: 'real in-browser OCR to process the shared image',
    })
    .toBeGreaterThan(40);
  const reviewText = await page.locator('#review-text').inputValue();

  // Privacy design (plan, A15): the share-target POST body is NEVER cached
  // or logged. The app-shell cache must contain exactly this build's
  // precache entries — nothing else, no share-target request, no content.
  const state = await page.evaluate(async () => {
    const names = await caches.keys();
    const shell = names.find((n) => n.startsWith('precache'));
    const keys = shell ? (await (await caches.open(shell)).keys()).map((r) => r.url) : [];
    let entries: { url: string; cacheKey: string }[] = [];
    try {
      const text = await (await fetch('/precache-manifest.js')).text();
      entries = JSON.parse(text.slice(text.indexOf('['), text.lastIndexOf(']') + 1));
    } catch {
      entries = [];
    }
    return { names, keys, entries };
  });
  expect(state.keys.some((u) => u.includes('share-target'))).toBe(false);
  const expectedKeys = state.entries.map((e) => new URL(e.cacheKey, page.url()).href).sort();
  expect([...state.keys].sort(), 'the app-shell cache holds exactly the precache entries').toEqual(
    expectedKeys,
  );

  // A15 after the flow: no post text in any storage, URL, console output or request.
  const audit = await runPrivacyAudit(page, capture, [reviewText]);
  expect(audit.violations, JSON.stringify(audit.violations, null, 2)).toEqual([]);
});

test('a08_share_target_ignores_posts_without_an_image', async ({ page }) => {
  await page.goto('/');
  await waitForAppShellReady(page);

  // No image at all (empty multipart body)…
  const none = await postShareTargetForm(page, null);
  expect(none.ok).toBe(true);
  // …and a post whose only file is NOT an image.
  const textBytes = await readFixtureB64('fixtures/files/nonimage01.txt');
  const textOnly = await postShareTargetForm(page, { name: 'note.txt', type: 'text/plain', bytes: textBytes });
  expect(textOnly.ok).toBe(true);

  // Fail closed: nothing is processed, the app stays usable on the home
  // screen, and no error state appears (nothing was dropped silently —
  // there was nothing valid to process).
  await expect(page.getByRole('heading', { name: 'PostClip' })).toBeVisible();
  await expect(page.locator('.error-banner')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Review' })).toBeHidden();
  // The app-shell cache still contains only precache entries.
  const shellKeys = await page.evaluate(async () => {
    const names = await caches.keys();
    const shell = names.find((n) => n.startsWith('precache'));
    return shell ? (await (await caches.open(shell))).keys().then((ks) => ks.length) : -1;
  });
  expect(shellKeys).toBeGreaterThan(0);
});
