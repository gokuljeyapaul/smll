import { test, expect, type Page } from '@playwright/test';
import { runPrivacyAudit, startCapture } from './helpers/privacy';
import { waitForAppShellReady } from './helpers/pwa';
import { ALLOWED_CACHE_NAME_PATTERNS } from '../src/privacy/audit';

/**
 * A15 (web): the no-storage audit as a first-class flow. After a full
 * happy-path flow (pick → OCR → cleanup → edit → share → copy → export),
 * only allow-listed storage exists and no post text appears in any
 * storage, URL, cookie, console output or network request.
 *
 * S2 evolution (planned in the allow-list, src/privacy/audit.ts): the
 * service-worker app shell now exists, so the app-shell precache cache is
 * the ONE cache allowed — and it must contain exactly this build's
 * precache entries (never share-target POST bodies, never post content;
 * plan "Privacy and no-storage design"). The model cache arrives in S3.
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
  await page.locator('#export-menu summary').click(); // open the export menu
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

  // The S2 app shell registers on this page's first load; wait until its
  // precache is complete so the structural cache assertions are
  // deterministic (if it never completes, the exact-keys check below
  // fails with a readable diff — never silently passes).
  await waitForAppShellReady(page);

  // Structural (allow-list) state, asserted directly from the snapshot:
  // no localStorage/sessionStorage/cookies ever; from S2 the ONLY cache
  // allowed is the app-shell precache (the model cache is S3).
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
  for (const name of snapshot.cacheNames) {
    expect(
      ALLOWED_CACHE_NAME_PATTERNS.some((p) => p.test(name)),
      `cache "${name}" must be on the A15 allow-list`,
    ).toBe(true);
  }
  // …and the app-shell cache holds EXACTLY this build's precache entries:
  // no share-target POST bodies, no post content, nothing dynamic.
  const precacheUrls = await page.evaluate(async () => {
    const text = await (await fetch('/precache-manifest.js')).text();
    const entries = JSON.parse(text.slice(text.indexOf('['), text.lastIndexOf(']') + 1)) as {
      cacheKey: string;
    }[];
    return entries.map((e) => new URL(e.cacheKey, location.origin).href).sort();
  });
  const cacheUrls = await page.evaluate(async () => {
    const names = await caches.keys();
    const shell = names.find((n) => n.startsWith('precache'));
    const keys = shell ? (await (await caches.open(shell)).keys()).map((r) => r.url) : [];
    return [...keys].sort();
  });
  expect(cacheUrls, 'the app-shell cache holds exactly the precache entries').toEqual(precacheUrls);
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
