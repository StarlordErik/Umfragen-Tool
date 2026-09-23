import { defineConfig } from '@playwright/test';
import reference from './playwright.reference.config';

process.env.OLIVE_BASE = '/projects/olive-symposium';

export default defineConfig({
  ...reference,
  outputDir: 'test-results',
  testMatch: '*.spec.ts',
  use: { ...reference.use, baseURL: 'http://127.0.0.1:8130' },
  webServer: [
    {
      command:
        'python tests/support/legacy_server.py --kind current --port 8132',
      url: 'http://127.0.0.1:8132/api/config',
      reuseExistingServer: false,
    },
    {
      command: 'node scripts/server.ts',
      url: 'http://127.0.0.1:8130',
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        PORT: '8130',
        HOST: '127.0.0.1',
        OLIVE_LEGACY_ORIGIN: 'http://127.0.0.1:8132',
        NODE_ENV: process.env.E2E_PRODUCTION ? 'production' : 'development',
      },
    },
  ],
});
