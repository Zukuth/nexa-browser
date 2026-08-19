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
    // Needs to outlive the real 1-minute threshold below plus a couple more
    // 5s poll ticks — well past playwright.config.js's global 30s default,
    // which is tuned for the rest of the suite's much shorter tests.
    test.setTimeout(120000);
    // 1 minute — NOT a tiny fractional value. main.js's startAutoEcoLoop
    // clamps with Math.max(1, cfg.minutes || 30), so anything below 1 is
    // silently floored back up to a full minute regardless; a smaller
    // configured value here would never actually trip and this test would
    // pass vacuously on nothing but its own (too-weak) assertion. Confirmed
    // live: that's exactly what was happening before this was fixed to use
    // a real value and a wait long enough to cross it.
    await page.evaluate(() => window.api.updateSettings({ autoEco: { enabled: true, minutes: 1 } }));

    await page.locator('#btn-new-tab').click();
    await expect(page.locator('.account-item')).toHaveCount(2);
    const state = await page.evaluate(() => window.api.getState());
    const accounts = state.accounts.filter((a) => !a.closed);
    const activeId = state.settings.activeAccountId;
    const backgroundedId = accounts.find((a) => a.id !== activeId).id;

    // Give the 5s poll loop time to cross the 1-minute threshold plus a
    // couple more ticks so eco:getSavings has a post-throttle CPU sample.
    await page.waitForTimeout(75000);

    const backgroundedEco = await page.evaluate(async (id) => {
      const s = await window.api.getState();
      return s.accounts.find((a) => a.id === id)?.ecoMode;
    }, backgroundedId);
    // The persisted manual field must stay untouched — this is a runtime-only
    // auto-throttle, never written back to account.ecoMode.
    expect(backgroundedEco).toBeFalsy();

    // eco:getSavings (see main.js) should now see this account as throttled,
    // with at least one before/after CPU sample recorded for it.
    const savings = await page.evaluate(() => window.api.getEcoSavings());
    expect(savings.throttledCount).toBeGreaterThanOrEqual(1);
  });
});
