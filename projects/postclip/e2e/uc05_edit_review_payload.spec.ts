import { test, expect, type Page, type TestInfo } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { runPrivacyAudit, startCapture } from './helpers/privacy';

/**
 * UC05 (A04, web): the user edits the cleaned text on the review screen,
 * and the shared, copied AND exported payloads reflect the edits exactly —
 * character for character. Ends with the A15 storage/log/request audit.
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

test('uc05_edit_reflects_in_payloads', async ({ page }, testInfo: TestInfo) => {
  const capture = startCapture(page);
  await spyNavigatorShare(page);
  await page.goto('/');

  await page.setInputFiles('#file-input', 'fixtures/images/clean01.png');
  await expect(page.getByRole('heading', { name: 'Your text' })).toBeVisible({ timeout: 120_000 });
  await expect
    .poll(async () => (await page.locator('#review-text').inputValue()).length, { timeout: 120_000 })
    .toBeGreaterThan(40);
  const original = await page.locator('#review-text').inputValue();

  // The cleaned review text must not contain UI chrome.
  expect(original).not.toContain('Like Comment Share');
  expect(original).not.toContain('reactions');

  // Edit the text; every payload must carry the edits exactly.
  const edited = original + '\n\nEdited while reviewing — every payload must carry this line.';
  await page.locator('#review-text').fill(edited);

  await page.locator('#share-btn').click();
  const shareCalls = await page.evaluate(() => {
    const w = window as unknown as { __shareCalls: { text?: string; title?: string }[] };
    return w.__shareCalls;
  });
  expect(shareCalls, 'navigator.share must have been called exactly once').toHaveLength(1);
  expect(shareCalls[0]?.text).toBe(edited);

  await page.locator('#copy-btn').click();
  await expect(page.getByText('Copied')).toBeVisible();
  if (testInfo.project.name === 'chromium') {
    const clipboardText = await page.evaluate(() => navigator.clipboard.readText());
    expect(clipboardText).toBe(edited);
  } else {
    const pasted = await verifyClipboardByPasteRoundTrip(page);
    expect(pasted, 'paste round-trip must deliver exactly the edited text').toBe(edited);
  }

  // The exported .txt must reflect the edits exactly (real download, read back).
  await page.locator('#export-menu summary').click(); // open the export menu
  const downloadPromise = page.waitForEvent('download');
  await page.locator('#export-txt').click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('postclip-export.txt');
  const exported = readFileSync(await download.path(), 'utf-8');
  expect(exported).toBe(edited);

  // A15: after the flow, only allow-listed storage exists; no post text in
  // storage, URL, console output or any network request.
  const audit = await runPrivacyAudit(page, capture, [original, edited]);
  expect(audit.violations, JSON.stringify(audit.violations, null, 2)).toEqual([]);
});
