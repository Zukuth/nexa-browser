// @ts-check
const { defineConfig } = require('@playwright/test');

// Electron testing doesn't use the browser-download / device matrix Playwright
// normally sets up — each test launches its own real electron/main.js process
// (see test/e2e/fixtures.js) against a throwaway --user-data-dir, so there's
// no shared server or browser channel to configure here.
module.exports = defineConfig({
  testDir: './test/e2e',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // Each Electron instance is a full app process (own window, own userData dir) —
  // much heavier than a browser tab/context. Running many at once on one machine
  // causes IPC/render races (geometry updates arriving late, etc.), so keep this
  // low rather than defaulting to one worker per CPU.
  workers: 2,
  reporter: process.env.CI ? 'list' : 'list'
});
