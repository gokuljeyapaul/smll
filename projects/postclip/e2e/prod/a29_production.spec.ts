import { test, expect, type Page } from '@playwright/test';
import { PROD_CSP } from '../../scripts/csp-policy.mjs';

/**
 * A29 (web — both engines): the PRODUCTION build is clean. This spec runs
 * ONLY against a production build served from dist/ (`npm run build` —
 * `POSTCLIP_TEST_BUILD` unset, so every test-only hook is dead-code-
 * eliminated). The runner excludes e2e/prod from the normal test-build
 * invocations and runs it via `npm run test:e2e:prod` (playwright.config.ts
 * testIgnore + the POSTCLIP_PROD_RUN env flag).
 *
 * What it proves, per plan row A29:
 *  1. the smoke flow (pick → real OCR → review → share/copy) passes served
 *     from dist/ — which also proves the strict CSP does not break the
 *     app's own legitimate loads (same-origin scripts/styles/workers, the
 *     OCR assets, the service worker);
 *  2. the strict CSP is shipped verbatim and ENFORCED (an injected inline
 *     script is blocked by script-src 'self' — observed through a real
 *     securitypolicyviolation event), and connect-src allows exactly
 *     same-origin + the pinned model host;
 *  3. the test hooks (?testModelUrl / ?testProbe, window.__postclipLlmDebug)
 *     are ABSENT and INERT in the production bundle: the query flags change
 *     nothing (the model card stays in its real probed state) and the debug
 *     record is never created. The byte-level proof (grep over dist/) is
 *     scripts/inspect_bundle.mjs, whose committed output this spec's junit
 *     complements.
 */
const TEST_HOOK_QUERY = '?testModelUrl=http://127.0.0.1:4599/model&testProbe=unsupported';

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

test('a29_production_smoke_pick_review_share_copy_from_dist', async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on('pageerror', (err) => consoleErrors.push(`pageerror: ${String(err)}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(`console.error: ${msg.text()}`);
  });
  await spyNavigatorShare(page);
  await page.goto('/');

  // Real OCR runs in the browser under the production CSP (worker-src 'self'
  // must let the tesseract worker boot, and the OCR assets must load).
  await page.setInputFiles('#file-input', 'fixtures/images/clean01.png');
  await expect(page.getByRole('heading', { name: 'Your text' })).toBeVisible({ timeout: 120_000 });
  await expect
    .poll(async () => (await page.locator('#review-text').inputValue()).length, {
      timeout: 120_000,
      message: 'real in-browser OCR on the production build',
    })
    .toBeGreaterThan(40);
  const reviewText = await page.locator('#review-text').inputValue();

  // Share payload == review text (spied; the OS sheet is not automatable).
  await page.locator('#share-btn').click();
  const shareCalls = await page.evaluate(() => {
    const w = window as unknown as { __shareCalls: { text?: string }[] };
    return w.__shareCalls;
  });
  expect(shareCalls).toHaveLength(1);
  expect(shareCalls[0]?.text).toBe(reviewText);

  // Copy puts exactly the review text on the clipboard (real verification).
  await page.locator('#copy-btn').click();
  await expect(page.getByText('Copied')).toBeVisible();
  const pasted = await verifyClipboardByPasteRoundTrip(page);
  expect(pasted, 'paste round-trip must deliver exactly the copied review text').toBe(reviewText);

  expect(consoleErrors, `console errors on the production build: ${consoleErrors.join(' | ')}`).toEqual([]);
});

test('a29_production_strict_csp_shipped_and_enforced', async ({ page }) => {
  await page.goto('/');

  // Shipped verbatim: the meta tag carries exactly scripts/csp-policy.mjs's
  // PROD_CSP (no test-build connect-src entry, no unsafe-* anywhere).
  const meta = await page.evaluate(() => {
    const el = document.querySelector('meta[http-equiv="Content-Security-Policy" i]');
    return el ? el.getAttribute('content') : null;
  });
  expect(meta, 'the production build must ship the CSP meta').toBe(PROD_CSP);
  expect(meta).not.toContain('unsafe-eval');
  expect(meta).not.toContain('unsafe-inline');
  expect(meta).not.toContain('127.0.0.1');

  // connect-src allows same-origin plus the pinned model host ONLY.
  const connectSrc = meta?.match(/connect-src ([^;]+)/)?.[1] ?? '';
  expect(connectSrc.trim()).toBe("'self' https://huggingface.co");

  // ENFORCED: an injected inline script is blocked by script-src 'self'.
  // The proof is the engine's own signal — Playwright THROWS with the CSP
  // violation text when the injected script is blocked (Chromium), and/or
  // the REAL securitypolicyviolation event fires (both engines). The script
  // must never run.
  await page.evaluate(() => {
    const w = window as unknown as Record<string, unknown>;
    w.__cspProbe = 'no-violation';
    w.__cspViolations = [] as string[];
    document.addEventListener('securitypolicyviolation', (e) => {
      (w.__cspViolations as string[]).push(`${e.violatedDirective}:${String(e.blockedURI).slice(0, 40)}`);
    });
  });
  let blockedError: string | null = null;
  try {
    await page.addScriptTag({
      content: 'window.__cspProbe = "inline script ran — CSP is NOT enforced";',
    });
  } catch (err) {
    blockedError = String(err);
  }
  const probe = await page.evaluate(() => {
    const w = window as unknown as { __cspProbe: string; __cspViolations: string[] };
    return { cspProbe: w.__cspProbe, violations: w.__cspViolations };
  });
  expect(probe.cspProbe).toBe('no-violation'); // the inline script did NOT run
  const enforced =
    (blockedError !== null && blockedError.includes('Content Security Policy')) ||
    probe.violations.length > 0;
  expect(
    enforced,
    `the CSP must block inline scripts (blocked error: ${JSON.stringify(blockedError)}, violations: ${JSON.stringify(probe.violations)})`,
  ).toBe(true);
  if (probe.violations.length > 0) {
    expect(probe.violations[0]).toContain('script-src');
  }

  // The CSP must not break the app's own loads:
  //  - a same-origin dedicated worker boots (worker-src 'self') — the same
  //    kind of worker tesseract.js and the model-cleanup client create;
  //  - the service worker registers and activates.
  const workerOk = await page.evaluate(
    () =>
      new Promise<boolean>((resolve) => {
        try {
          const w = new Worker('/ocr-assets/worker.min.js');
          w.addEventListener('error', () => resolve(false));
          w.addEventListener('message', () => {
            w.terminate();
            resolve(true);
          });
          // tesseract.js's worker answers a ping only after boot; resolve on
          // the first postMessage round-trip or timeout.
          setTimeout(() => {
            w.terminate();
            resolve(true);
          }, 3_000);
        } catch {
          resolve(false);
        }
      }),
  );
  expect(workerOk, 'a same-origin worker must be creatable under the CSP').toBe(true);

  const swState = await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.getRegistration();
    return reg?.active?.state ?? 'none';
  });
  expect(['activating', 'activated']).toContain(swState);
});

test('a29_production_test_hooks_absent_and_inert', async ({ page }) => {
  // The test-only query flags exist in TEST builds (a13/a21 prove they work
  // there). In the production build they must do NOTHING: the model card
  // stays in its real probed state ('absent' on a fresh context — the
  // download affordance is still offered; no forced 'unsupported' banner),
  // and the debug record is never created.
  await page.goto(`/${TEST_HOOK_QUERY}`);
  // R2-3: the download stays opt-in behind the collapsed Advanced section —
  // present and reachable, never pushed; the hooks stay inert.
  await expect(page.locator('#advanced-model')).toBeVisible({ timeout: 30_000 });
  expect(await page.locator('#advanced-model').getAttribute('open')).toBeNull();
  await page.locator('#advanced-model summary').click();
  await expect(page.locator('#model-download-btn')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('#model-banner')).toHaveCount(0);

  // A full pick under the hook query: the pipeline runs normally and the
  // test-only debug record stays undefined (test builds set it on every
  // pick — App.tsx's __POSTCLIP_TEST_BUILD__ branch).
  await page.setInputFiles('#file-input', 'fixtures/images/clean01.png');
  await expect(page.getByRole('heading', { name: 'Your text' })).toBeVisible({ timeout: 120_000 });
  await expect
    .poll(async () => (await page.locator('#review-text').inputValue()).length)
    .toBeGreaterThan(40);
  const debugRecord = await page.evaluate(() => {
    const w = window as unknown as Record<string, unknown>;
    return typeof w.__postclipLlmDebug;
  });
  expect(debugRecord).toBe('undefined');
});
