const { test, expect } = require('./fixtures');

// The app's toggle switches use the standard "visually-hidden native
// checkbox + styled .slider sibling inside a <label>" pattern (see
// .switch/.switch input/.switch .slider in style.css) — the raw <input>
// collapses to a 0x0 box by design, so Playwright's actionability checks
// (which require a real, visible target) must click the wrapping <label>
// instead, exactly like a real user clicking the visible slider would.
// State assertions (toBeChecked) read the DOM `checked` property directly
// and work regardless of visibility.
function switchLabelFor(page, inputId) {
  return page.locator(`label.switch:has(#${inputId})`);
}

test.describe('stability settings', () => {
  test('Estabilidad tab renders and its toggles persist after closing and reopening the panel', async ({ page }) => {
    await page.locator('#tb-poke-idle').click();
    await page.locator('.poke-nav-item[data-poke-scroll="ajustes"]').click();
    await page.locator('.poke-settings-tab[data-poke-settings-tab="stability"]').click();

    await expect(page.locator('.poke-settings-panel.active[data-poke-settings-panel="stability"]')).toHaveCount(1);

    const enabledToggle = page.locator('#stability-enabled');
    await expect(enabledToggle).not.toBeChecked(); // default OFF
    await expect(page.locator('#stability-last-resort-reload')).not.toBeChecked(); // must default OFF per the stability rules

    // Flip the two toggles that matter most (master enable + backgroundKeepalive)
    // and confirm the change round-trips through settings:update and survives
    // a close/reopen of the panel — same persistence contract every other
    // poke-idle setting already has.
    await switchLabelFor(page, 'stability-enabled').click();
    await switchLabelFor(page, 'stability-keepalive').click();

    await expect.poll(async () => page.evaluate(() => window.api.getState().then((s) => s.settings.stability.enabled))).toBe(true);
    await expect.poll(async () => page.evaluate(() => window.api.getState().then((s) => s.settings.stability.backgroundKeepalive))).toBe(true);

    await page.locator('#btn-close-poke-idle').click();
    await page.locator('#tb-poke-idle').click();
    await page.locator('.poke-nav-item[data-poke-scroll="ajustes"]').click();
    await page.locator('.poke-settings-tab[data-poke-settings-tab="stability"]').click();

    await expect(page.locator('#stability-enabled')).toBeChecked();
    await expect(page.locator('#stability-keepalive')).toBeChecked();
    // lastResortAutoReload must still be untouched/off — flipping the other
    // two toggles must not have silently enabled it.
    await expect(page.locator('#stability-last-resort-reload')).not.toBeChecked();
  });

  test('per-account "perfil limpio" toggle persists on the account, not globally', async ({ page }) => {
    await page.locator('#tb-poke-idle').click();
    await page.locator('.poke-nav-item[data-poke-scroll="ajustes"]').click();
    await page.locator('.poke-settings-tab[data-poke-settings-tab="stability"]').click();

    const cleanProfile = page.locator('#poke-settings-clean-profile');
    await expect(cleanProfile).not.toBeChecked();
    await switchLabelFor(page, 'poke-settings-clean-profile').click();

    await expect.poll(async () => page.evaluate(() => window.api.getState().then((s) => s.accounts[0].cleanGameProfile))).toBe(true);
  });
});
