const { _electron: electron, test: base, expect } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const os = require('os');

const PROJECT_ROOT = path.join(__dirname, '..', '..');

// Each test gets its own throwaway --user-data-dir so accounts/spaces from one
// test never leak into another and tests can run in parallel without fighting
// over electron's single-instance lock (which is keyed off that directory).
const test = base.extend({
  userDataDir: async ({}, use) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexa-e2e-'));
    await use(dir);
    // Windows can briefly hold file handles open (e.g. safeStorage/DPAPI, the
    // data.json temp-file rename) right after the electron process exits —
    // retry instead of failing the test on a transient EPERM/EBUSY.
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  },

  electronApp: async ({ userDataDir }, use) => {
    const app = await electron.launch({
      args: [PROJECT_ROOT, `--user-data-dir=${userDataDir}`],
      executablePath: require('electron')
    });
    await use(app);
    await app.close();
  },

  page: async ({ electronApp }, use) => {
    const page = await electronApp.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    // init() in renderer.js auto-adds one account on first launch (empty space),
    // which by default would load the space's defaultUrl (google.com). Point
    // both the fallback and the default space at about:blank first so opening
    // accounts in tests never depends on network access.
    await page.evaluate(() => window.api.updateSettings({ defaultStartUrl: 'about:blank' }));
    await page.evaluate(() => window.api.updateSpace('default', { defaultUrl: 'about:blank' }));
    // Wait for the auto-added first account to actually land in state so every
    // test starts from the same known baseline (1 open account).
    await expect(page.locator('.account-item')).toHaveCount(1);
    await use(page);
  }
});

// .account-remove is `visibility: hidden` until `.account-item:hover` (see
// style.css). A synthetic CDP mousemove does apply :hover, but the sidebar
// fully re-renders every second (setInterval(render, 1000) in renderer.js)
// and the freshly-inserted button doesn't inherit that hover state without a
// real, continuous pointer position — leaving a real click racing against
// that render tick. Dispatching the click event directly exercises the same
// onclick handler without depending on that timing.
async function closeAccountAt(page, index) {
  const item = page.locator('.account-item').nth(index);
  await item.hover();
  await item.locator('.account-remove').dispatchEvent('click');
}

// The chrome UI re-renders panel-headers/dividers from scratch on every state
// broadcast, plus once a second regardless (setInterval(render, 1000) in
// renderer.js) — a boundingBox() call can land in the single frame where the
// old node was just torn down and the new one isn't painted yet, returning
// null. Poll until a real box comes back instead of trusting a single read.
async function stableBoundingBox(locator) {
  let box = null;
  await expect.poll(async () => {
    box = await locator.boundingBox();
    return box;
  }, { message: 'waiting for a non-null boundingBox' }).not.toBeNull();
  return box;
}

module.exports = { test, expect, closeAccountAt, stableBoundingBox };
