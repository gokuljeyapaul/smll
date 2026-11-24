import { test, expect, type Page, type TestInfo } from '@playwright/test';
import { runPrivacyAudit, startCapture } from './helpers/privacy';

/**
 * UC01 + UC06 (A02, A03, web): pick a fixture screenshot, real in-browser OCR
 * runs, the review screen shows the extracted text, Share is called with a
 * payload equal to the review text (navigator.share is spied — the OS share
 * sheet is not automatable, see A27), and Copy puts exactly that text on the
 * clipboard.
 *
 * Clipboard verification per engine (probed on this runner, see
 * docs/evidence/S0/runner-smoke.md):
 *  - Chromium: permissions `clipboard-read`/`clipboard-write` are granted in
 *    playwright.config.ts, so Copy is verified with a direct real clipboard read.
 *  - WebKit: Playwright's WebKit grants no clipboard permissions and readText is
 *    platform-denied (recorded honestly); writeText needs no permission, and the
 *    clipboard content is verified with a real paste round-trip (the e2e appends
 *    a probe textarea, presses Ctrl/Cmd+V, and reads what the browser pasted —
 *    nothing is faked inside the app).
 */

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

async function verifyClipboardByPasteRoundTrip(page: Page): Promise<string> {
  await page.evaluate(() => {
    const ta = document.createElement('textarea');
    ta.id = 'paste-probe-target';
    ta.setAttribute('aria-label', 'e2e paste probe');
    ta.style.cssText =
      'position:fixed;bottom:4px;left:4px;width:160px;height:28px;opacity:0.95;z-index:9999;';
    document.body.appendChild(ta);
  });
  await page.locator('#paste-probe-target').click();
  await page.keyboard.press('ControlOrMeta+V');
  const pasted = await page.locator('#paste-probe-target').inputValue();
  await page.evaluate(() => document.getElementById('paste-probe-target')?.remove());
  return pasted;
}

test('uc01_pick_ocr_review_share', async ({ page }, testInfo: TestInfo) => {
  const capture = startCapture(page);
  await spyNavigatorShare(page);
  await page.goto('/');

  await page.setInputFiles('#file-input', 'fixtures/images/clean01.png');

  // Real OCR runs in the browser; the review screen appears with the text.
  await expect(page.getByRole('heading', { name: 'Your text' })).toBeVisible({ timeout: 120_000 });
  await expect
    .poll(async () => (await page.locator('#review-text').inputValue()).length, {
      timeout: 120_000,
      message: 'real in-browser OCR to produce the extracted text',
    })
    .toBeGreaterThan(40);
  const reviewText = await page.locator('#review-text').inputValue();

  // S1: the review text is the CLEANED body — UI chrome is gone.
  expect(reviewText).not.toContain('Like Comment Share');
  expect(reviewText).not.toContain('reactions');

  // A03: Web Share is called with a text payload equal to the review text.
  await page.locator('#share-btn').click();
  const shareCalls = await page.evaluate(() => {
    const w = window as unknown as { __shareCalls: { text?: string; title?: string }[] };
    return w.__shareCalls;
  });
  expect(shareCalls, 'navigator.share must have been called exactly once').toHaveLength(1);
  expect(shareCalls[0]?.text).toBe(reviewText);

  // A03: Copy puts exactly the review text on the clipboard.
  await page.locator('#copy-btn').click();
  await expect(page.getByText('Copied')).toBeVisible();

  if (testInfo.project.name === 'chromium') {
    const clipboardText = await page.evaluate(() => navigator.clipboard.readText());
    expect(clipboardText).toBe(reviewText);
  } else {
    const pasted = await verifyClipboardByPasteRoundTrip(page);
    expect(pasted, 'paste round-trip must deliver exactly the copied review text').toBe(reviewText);
  }

  // A15: no post text in any storage, URL, console output or network request.
  const audit = await runPrivacyAudit(page, capture, [reviewText]);
  expect(audit.violations, JSON.stringify(audit.violations, null, 2)).toEqual([]);
});
