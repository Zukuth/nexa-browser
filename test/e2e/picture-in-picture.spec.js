const { test, expect } = require('./fixtures');

// Regression coverage for the "PiP freezes/closes on account switch" fix:
// positionWebviews() (src/renderer.js) must not apply .hidden-panel
// (display:none) to an account flagged .pip-active — a hidden guest stops
// compositing entirely, which is exactly what broke the floating
// Picture-in-Picture window before this fix. Instead it should stay
// painted off-screen (left/top moved out of the viewport, same size).
//
// This drives positionWebviews() directly (it's a plain global — renderer.js
// is a classic, unwrapped <script>) rather than through a real
// requestPictureInPicture() call: that needs a genuine <video> element and a
// real user gesture inside the guest <webview>'s own page, which isn't
// reachable through Playwright's Electron support the same way a normal
// page is. The actual browser-level behavior (does Chromium really keep
// compositing a display:block-but-offscreen guest) was verified live and
// separately — see the commit message for 5ec099f.
test.describe('Picture-in-Picture cross-account persistence', () => {
  test('a pip-active account is moved off-screen instead of hidden when it becomes the background panel', async ({ page }) => {
    await page.locator('#btn-new-tab').click();
    await expect(page.locator('.account-item')).toHaveCount(2);

    const state = await page.evaluate(() => window.api.getState());
    const [firstId, secondId] = state.accounts.map((a) => a.id);

    // Account 1 (currently active/visible) gets flagged pip-active, exactly
    // as onPipState's handler in renderer.js would on a real
    // 'enterpictureinpicture' event.
    await page.evaluate((id) => {
      document.getElementById('wv-' + id).classList.add('pip-active');
    }, firstId);

    // Switch to account 2 — account 1 is now the backgrounded panel.
    await page.locator('.account-item').nth(1).click();
    await expect(page.locator('.account-item').nth(1)).toHaveClass(/active/);

    const firstEl = page.locator('#wv-' + firstId);
    const secondEl = page.locator('#wv-' + secondId);

    // The pip-active account must NOT get display:none...
    await expect(firstEl).not.toHaveClass(/hidden-panel/);
    await expect(firstEl).not.toHaveCSS('display', 'none');
    // ...but must be moved off-screen, not left in its old on-screen rect.
    const leftPx = await firstEl.evaluate((el) => parseFloat(el.style.left));
    expect(leftPx).toBeLessThan(-1000);

    // The newly active account, meanwhile, is positioned normally on-screen.
    await expect(secondEl).not.toHaveClass(/hidden-panel/);
    const secondLeftPx = await secondEl.evaluate((el) => parseFloat(el.style.left));
    expect(secondLeftPx).toBeGreaterThanOrEqual(0);
  });

  test('an account without pip-active still gets hidden normally when backgrounded', async ({ page }) => {
    await page.locator('#btn-new-tab').click();
    await expect(page.locator('.account-item')).toHaveCount(2);

    const state = await page.evaluate(() => window.api.getState());
    const [firstId] = state.accounts.map((a) => a.id);

    await page.locator('.account-item').nth(1).click();

    // No pip-active flag here — this is the pre-existing, still-correct path.
    await expect(page.locator('#wv-' + firstId)).toHaveClass(/hidden-panel/);
  });
});
