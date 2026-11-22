import { test, expect } from '@playwright/test';

/**
 * A01 (web): from a clean checkout `npm ci && npm run build` succeeds and the
 * built app loads and renders the home screen in Chromium and WebKit with no
 * console errors. The suite runs against `vite preview` of the built dist/.
 */
test('a01_built_app_loads_home_screen_no_console_errors', async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => consoleErrors.push(String(err)));

  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'PostClip' })).toBeVisible();
  await expect(page.getByTestId('dropzone')).toBeVisible();

  expect(consoleErrors, `console errors: ${consoleErrors.join(' | ')}`).toEqual([]);
});
