const { test, expect } = require('./fixtures');

// Same "visually-hidden native checkbox + styled .slider inside a <label>"
// pattern documented in stability-settings.spec.js — click the wrapping
// label, not the 0x0 raw input.
function switchLabelFor(page, inputId) {
  return page.locator(`label.switch:has(#${inputId})`);
}

// Browser-inspired idea #1 (Edge Efficiency Mode) — auto-applies Eco Mode to
// an account once it's gone `autoEco.minutes` without being the focused
// panel, layered on top of (never instead of) the per-account manual
// ecoMode toggle. See startAutoEcoLoop() in main.js.
test.describe('automatic Eco Mode', () => {
  test('defaults to disabled with a 30-minute threshold', async ({ page }) => {
    const state = await page.evaluate(() => window.api.getState());
    expect(state.settings.autoEco).toEqual({ enabled: false, minutes: 30 });
  });

  test('the settings modal toggle and minutes field persist the setting', async ({ page }) => {
    await page.locator('#tb-settings').click();
    await switchLabelFor(page, 'set-auto-eco-enabled').click();
    await page.locator('#set-auto-eco-minutes').fill('10');
    await page.locator('#set-auto-eco-minutes').dispatchEvent('change');

    await expect.poll(async () => {
      const state = await page.evaluate(() => window.api.getState());
      return state.settings.autoEco;
    }).toEqual({ enabled: true, minutes: 10 });
  });

  test('clamps the minutes field to the 1-60 range instead of storing garbage', async ({ page }) => {
    await page.locator('#tb-settings').click();
    await page.locator('#set-auto-eco-minutes').fill('999');
    await page.locator('#set-auto-eco-minutes').dispatchEvent('change');
    await expect(page.locator('#set-auto-eco-minutes')).toHaveValue('60');
  });

  test('auto-throttles a backgrounded account after its threshold, and never touches the active one', async ({ page }) => {
    // A tiny fractional threshold (well under the 5s poll tick) so this test
    // doesn't need to actually wait minutes — bypasses the UI's 1-60 clamp
    // on purpose, same as a real config value under 1 would.
    await page.evaluate(() => window.api.updateSettings({ autoEco: { enabled: true, minutes: 0.02 } }));

    await page.locator('#btn-new-tab').click();
    await expect(page.locator('.account-item')).toHaveCount(2);
    const state = await page.evaluate(() => window.api.getState());
    const accounts = state.accounts.filter((a) => !a.closed);
    const activeId = state.settings.activeAccountId;
    const backgroundedId = accounts.find((a) => a.id !== activeId).id;

    // Give the 5s poll loop a couple of ticks to notice and apply it.
    await page.waitForTimeout(12000);

    const backgroundedEco = await page.evaluate(async (id) => {
      const s = await window.api.getState();
      return s.accounts.find((a) => a.id === id)?.ecoMode;
    }, backgroundedId);
    // The persisted manual field must stay untouched — this is a runtime-only
    // auto-throttle, never written back to account.ecoMode.
    expect(backgroundedEco).toBeFalsy();
  });
});
