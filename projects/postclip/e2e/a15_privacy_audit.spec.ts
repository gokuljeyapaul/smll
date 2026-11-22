import { test, expect, type Page } from '@playwright/test';
import { runPrivacyAudit, startCapture } from './helpers/privacy';

/**
 * A15 (web): the no-storage audit as a first-class flow. After a full
 * happy-path flow (pick → OCR → cleanup → edit → share → copy → export),
 * only allow-listed storage exists and no post text appears in any
 * storage, URL, cookie, console output or network request.
 *
 * The second testcase is the NEGATIVE CONTROL: a seeded leak must be
 * DETECTED by the audit (proving the audit is real, not trivially empty —
 * plan P05), and the seeded state is cleaned up afterwards.
 */

async function runFullFlow(page: Page): Promise<{ original: string; edited: string }> {
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
  await page.goto('/');
  await page.setInputFiles('#file-input', 'fixtures/images/clean01.png');
  await expect
    .poll(async () => (await page.locator('#review-text').inputValue()).length, { timeout: 120_000 })
    .toBeGreaterThan(40);
  const original = await page.locator('#review-text').inputValue();
  const edited = original + '\n\nauditmarker-9d2f a line the audits must watch everywhere';
  await page.locator('#review-text').fill(edited);
  await page.locator('#share-btn').click();
  await page.locator('#copy-btn').click();
  await expect(page.getByText('Copied')).toBeVisible();
  const downloadPromise = page.waitForEvent('download');
  await page.locator('#export-md').click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('postclip-export.md');
  return { original, edited };
}

test('a15_no_storage_log_request_leaks_after_flows', async ({ page }) => {
  const capture = startCapture(page);
  const { original, edited } = await runFullFlow(page);

  const audit = await runPrivacyAudit(page, capture, [original, edited]);
  expect(audit.violations, JSON.stringify(audit.violations, null, 2)).toEqual([]);

  // Structural (allow-list) state is also asserted directly from the
  // snapshot: S1 allows NO storage at all (no service worker, no model yet).
  const snapshot = await page.evaluate(async () => {
    let cacheNames: string[] = [];
    try {
      if (typeof caches !== 'undefined') cacheNames = await caches.keys();
    } catch {
      cacheNames = [];
    }
    return {
      localStorageKeys: Object.keys(localStorage),
      sessionStorageKeys: Object.keys(sessionStorage),
      cacheNames,
      cookies: document.cookie,
    };
  });
  expect(snapshot.localStorageKeys, 'no localStorage entries allowed').toEqual([]);
  expect(snapshot.sessionStorageKeys, 'no sessionStorage entries allowed').toEqual([]);
  expect(snapshot.cacheNames, 'no Cache Storage entries allowed in S1').toEqual([]);
  expect(snapshot.cookies, 'no cookies allowed').toBe('');
  expect(audit.requestCount).toBeGreaterThan(0);
  expect(audit.crossOriginRequests, 'all requests must be same-origin').toEqual([]);
});

test('a15_audit_negative_control_detects_seeded_leak', async ({ page }) => {
  const capture = startCapture(page);
  await page.goto('/');

  // Seed a violation like a buggy build could produce, then prove the
  // audit catches it in this real browser.
  await page.evaluate(() => {
    localStorage.setItem('post-draft', 'Shipped our first offline-first release today. auditmarker-9d2f');
  });

  const audit = await runPrivacyAudit(page, capture, [
    'Shipped our first offline-first release today.',
    'auditmarker-9d2f',
  ]);
  const storageViolations = audit.violations.filter((v) => v.where.includes('localStorage'));
  expect(storageViolations.length, JSON.stringify(audit.violations, null, 2)).toBeGreaterThan(0);
  expect(storageViolations[0]?.detail).toContain('post-draft');

  // Clean up the seeded state so nothing leaks out of this test.
  await page.evaluate(() => localStorage.clear());
  const after = await runPrivacyAudit(page, capture, [
    'Shipped our first offline-first release today.',
    'auditmarker-9d2f',
  ]);
  expect(after.violations).toEqual([]);
});
