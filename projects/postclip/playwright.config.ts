import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 180_000,
  expect: { timeout: 30_000 },
  // Environment roulette, documented in issue #58: some CI browser contexts
  // never deliver the 397 MB localhost model body (Chromium network-stack
  // stall; per-context persistent — every watchdog abort in such a context
  // also stalls). The app itself handles those contexts correctly (loud
  // abort, fail-closed give-up). This retry re-runs the SAME test fully in a
  // FRESH context whose network stack works: nothing is skipped or loosened,
  // and locally (no CI env) the count is 0.
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.PW_JUNIT ? process.env.PW_JUNIT : 'list',
  outputDir: 'test-results',
  // S5 (A29): e2e/prod/ specs assert PRODUCTION-build properties (the strict
  // CSP shipped verbatim, test hooks absent) and run ONLY against a
  // production build — `npm run test:e2e:prod` sets POSTCLIP_PROD_RUN=1 and
  // runs that directory after `npm run build`. Normal test-build invocations
  // (npm run test:e2e, CI's test.sh) skip the directory.
  testIgnore: process.env.POSTCLIP_PROD_RUN ? undefined : /e2e\/prod\//,
  use: {
    baseURL: 'http://localhost:4173',
    video: 'on',
    trace: 'retain-on-failure',
    // S1 (A05): the export flows assert real browser downloads.
    acceptDownloads: true,
  },
  webServer: {
    command: 'npm run preview',
    url: 'http://localhost:4173',
    reuseExistingServer: false,
    timeout: 120_000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], permissions: ['clipboard-read', 'clipboard-write'] },
    },
    {
      name: 'webkit',
      // Playwright's WebKit grants no clipboard permissions (its permission map
      // covers geolocation/notifications/etc. only); writeText needs none and
      // the copy verification uses a real paste round-trip. See runner-smoke.md.
      use: { ...devices['Desktop Safari'] },
    },
  ],
});
