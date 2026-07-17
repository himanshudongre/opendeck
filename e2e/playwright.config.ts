import { defineConfig, devices } from '@playwright/test';

/**
 * Simulator-driven E2E (SPEC §9): three viewports against a built hub running
 * the demo fleet at high speed. Device descriptors run on chromium so one
 * browser download covers CI; the viewports and touch behavior still match.
 */
export default defineConfig({
  testDir: 'tests',
  globalSetup: './global-setup.ts',
  globalTeardown: './global-teardown.ts',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  // Suites share two live hubs; serial execution keeps demo state predictable.
  workers: 1,
  fullyParallel: false,
  retries: process.env.CI === undefined ? 0 : 1,
  reporter: process.env.CI === undefined ? 'list' : [['list'], ['html', { open: 'never' }]],
  use: {
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'iphone-14',
      use: {
        ...devices['iPhone 14'],
        browserName: 'chromium',
        defaultBrowserType: 'chromium',
      },
    },
    {
      name: 'ipad',
      use: {
        ...devices['iPad (gen 11)'],
        browserName: 'chromium',
        defaultBrowserType: 'chromium',
      },
    },
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
