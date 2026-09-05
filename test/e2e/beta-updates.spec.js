const { test, expect } = require('./fixtures');

// Same "visually-hidden native checkbox + styled .slider inside a <label>"
// pattern documented in auto-eco.spec.js/stability-settings.spec.js.
function switchLabelFor(page, inputId) {
  return page.locator(`label.switch:has(#${inputId})`);
}

// autoUpdater.allowPrerelease is read fresh from data.settings.betaUpdates at
// the next app launch (see main.js) — this only covers the toggle actually
// persisting the setting through the settings modal, not the update-channel
// behavior itself (that's electron-updater's own, already-released logic).
test.describe('beta updates opt-in', () => {
  test('defaults to disabled', async ({ page }) => {
    const state = await page.evaluate(() => window.api.getState());
    expect(!!state.settings.betaUpdates).toBe(false);
  });

  test('the settings modal toggle (Acerca de tab) persists the setting', async ({ page }) => {
    await page.locator('#tb-settings').click();
    await page.locator('.settings-nav-item[data-tab="acerca"]').click();
    await switchLabelFor(page, 'set-beta-updates').click();

    await expect.poll(async () => {
      const state = await page.evaluate(() => window.api.getState());
      return state.settings.betaUpdates;
    }).toBe(true);

    // Reopening the modal reflects the persisted value, not just the DOM's
    // own memory of the click.
    await page.locator('#btn-close-settings').click();
    await page.locator('#tb-settings').click();
    await page.locator('.settings-nav-item[data-tab="acerca"]').click();
    await expect(page.locator('#set-beta-updates')).toBeChecked();
  });
});
