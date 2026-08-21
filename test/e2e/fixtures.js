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
    const dataFile = path.join(userDataDir, 'nexa-browser-data.json');
    fs.writeFileSync(
      dataFile,
      JSON.stringify({ settings: { hardwareAcceleration: false } }, null, 2),
      'utf-8'
    );
    const app = await electron.launch({
      args: [PROJECT_ROOT, '--disable-gpu', '--use-angle=warp', `--user-data-dir=${userDataDir}`],
      env: { ...process.env, NEXA_E2E: '1' },
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
// can still re-render reactively off a state broadcast (render() in
// renderer.js — no longer its own 1s ticker, see the comment near
// listDragInProgress there) and the freshly-inserted button doesn't inherit
// that hover state without a real, continuous pointer position — leaving a
// real click racing against that render. Dispatching the click event
// directly exercises the same onclick handler without depending on that
// timing.
async function closeAccountAt(page, index) {
  const item = page.locator('.account-item').nth(index);
  await item.hover();
  await item.locator('.account-remove').dispatchEvent('click');
}

// The chrome UI re-renders panel-headers/dividers from scratch on every state
// broadcast (render() in renderer.js) — a boundingBox() call can land in the
// single frame where the old node was just torn down and the new one isn't
// painted yet, returning null. Also, right after a divider drag's mouseup,
// onUp() synchronously re-renders headers from the still-stale pre-drag
// panelsGeometry before the async commitSplit()→setSplit IPC round-trip pushes the real, post-drag
// geometry a few ms later — a single read can land in that transient
// snap-back frame. Poll until the box comes back non-null AND stops
// changing across consecutive reads, not just until it's non-null once.
async function stableBoundingBox(locator) {
  let box = null;
  let stableCount = 0;
  await expect.poll(async () => {
    const next = await locator.boundingBox();
    const same = next && box && next.x === box.x && next.y === box.y && next.width === box.width && next.height === box.height;
    stableCount = same ? stableCount + 1 : 0;
    box = next;
    return box && stableCount >= 2;
  }, { message: 'waiting for boundingBox to stop changing' }).toBe(true);
  return box;
}

module.exports = { test, expect, closeAccountAt, stableBoundingBox };
