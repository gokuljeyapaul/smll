import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 180_000,
  expect: { timeout: 30_000 },
  reporter: process.env.PW_JUNIT ? process.env.PW_JUNIT : 'list',
  outputDir: 'test-results',
  use: {
    baseURL: 'http://localhost:4173',
    video: 'on',
    trace: 'retain-on-failure',
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
