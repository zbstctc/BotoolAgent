import { defineConfig } from '@playwright/test';

// TEST_PORT: dynamically assigned by BotoolAgent testing pipeline (3200+)
// Never use 3100 (main Viewer) for testing
const testPort = parseInt(process.env.TEST_PORT ?? '3200');

export default defineConfig({
  testDir: './tests',
  timeout: 30 * 1000,
  expect: {
    timeout: 5000,
  },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 1,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL: `http://localhost:${testPort}`,
    trace: 'on-first-retry',
  },
  webServer: {
    // TURBOPACK= unsets any global TURBOPACK=1 env var to avoid bundler flag conflict
    // --webpack: use webpack instead of Turbopack to avoid symlinked node_modules issues in worktrees
    command: `TURBOPACK= npm run dev -- --port ${testPort} --webpack`,
    url: `http://localhost:${testPort}`,
    reuseExistingServer: false,
  },
});
