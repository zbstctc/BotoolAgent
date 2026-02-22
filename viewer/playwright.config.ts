import { defineConfig } from '@playwright/test';

// TEST_PORT: dynamically assigned by BotoolAgent testing pipeline (3200+)
// Set REUSE_SERVER=1 to point at an already-running dev server (avoids Next.js dev lock conflict)
// Never use 3100 (main Viewer) for testing
const testPort = parseInt(process.env.TEST_PORT ?? '3200');
const reuseExistingServer = !!process.env.REUSE_SERVER;

export default defineConfig({
  testDir: './tests',
  timeout: 30 * 1000,
  expect: {
    timeout: 5000,
  },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 1,
  // workers=1: stress tests use internal concurrency (multiple pages/contexts per test);
  // extra Playwright workers overload the webpack dev server causing ERR_CONNECTION_REFUSED.
  workers: 1,
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
    reuseExistingServer,
  },
});
