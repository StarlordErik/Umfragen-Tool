import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  outputDir: '.artifacts/reference-results',
  testMatch: 'olive.spec.ts',
  workers: 1,
  fullyParallel: false,
  timeout: 60_000,
  expect: { toHaveScreenshot: { maxDiffPixels: 0, animations: 'disabled' } },
  snapshotPathTemplate: '{testDir}/__screenshots__/{projectName}/{arg}{ext}',
  use: { baseURL: 'http://127.0.0.1:8131', trace: 'retain-on-failure' },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1440, height: 1000 } } },
    {
      name: 'mobile',
      use: {
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
  webServer: {
    command:
      'python tests/support/legacy_server.py --kind reference --port 8131',
    url: 'http://127.0.0.1:8131/api/config',
    reuseExistingServer: false,
  },
});
