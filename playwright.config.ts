import { defineConfig } from '@playwright/test';
import { loadEnv } from 'vite';
Object.assign(process.env, loadEnv('test', process.cwd(), ''));
export default defineConfig({
  testDir: 'tests/e2e',
  use: {
    channel: process.env.PLAYWRIGHT_CHANNEL,
    baseURL: process.env.APP_ORIGIN || 'http://localhost:5173',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  workers: 1,
  timeout: 60000,
  webServer: {
    command: 'npm run dev',
    url: (process.env.APP_ORIGIN || 'http://localhost:5173') + '/api/health',
    reuseExistingServer: true,
  },
});
