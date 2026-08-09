const fs = require('fs');
const { test, expect } = require('./fixtures');

// Covers the two browser-inspired features added 2026-08-09: tiered
// tracking protection (replacing the old adBlockEnabled on/off) and the
// built-in screenshot tool.
test.describe('tracking protection levels', () => {
  test('defaults to "standard" on a fresh install', async ({ page }) => {
    const state = await page.evaluate(() => window.api.getState());
    expect(state.settings.protectionLevel).toBe('standard');
  });

  test('clicking the shield icon opens a level picker, and choosing a level persists it', async ({ page }) => {
    await page.locator('#tb-shield').click();
    await expect(page.locator('#protection-menu')).not.toHaveClass(/hidden/);

    await page.locator('.protection-option[data-level="strict"]').click();
    await expect.poll(async () => {
      const state = await page.evaluate(() => window.api.getState());
      return state.settings.protectionLevel;
    }).toBe('strict');

    await expect(page.locator('#protection-menu')).toHaveClass(/hidden/);
  });

  test('the settings modal select reflects and updates the same setting', async ({ page }) => {
    await page.evaluate(() => window.api.updateSettings({ protectionLevel: 'off' }));
    await page.locator('#tb-settings').click();
    await expect(page.locator('#set-protection-level')).toHaveValue('off');

    await page.locator('#set-protection-level').selectOption('strict');
    await expect.poll(async () => {
      const state = await page.evaluate(() => window.api.getState());
      return state.settings.protectionLevel;
    }).toBe('strict');
  });

  test('rejects an invalid protectionLevel value instead of storing garbage', async ({ page }) => {
    await page.evaluate(() => window.api.updateSettings({ protectionLevel: 'standard' }));
    await page.evaluate(() => window.api.updateSettings({ protectionLevel: 'nonsense' }));
    const state = await page.evaluate(() => window.api.getState());
    expect(state.settings.protectionLevel).toBe('standard');
  });
});

test.describe('screenshot capture', () => {
  test('captures the active account and writes a real PNG file to disk', async ({ page }) => {
    const active = (await page.evaluate(() => window.api.getState())).settings.activeAccountId;
    const result = await page.evaluate((id) => window.api.captureScreenshot(id), active);

    expect(result.ok).toBe(true);
    expect(fs.existsSync(result.path)).toBe(true);
    const bytes = fs.readFileSync(result.path);
    // PNG magic number — confirms it's a real image, not an empty/corrupt file.
    expect(bytes.slice(0, 8).toString('hex')).toBe('89504e470d0a1a0a');

    fs.unlinkSync(result.path); // self-cleaning — this writes to the real OS Pictures folder
  });

  test('the toolbar screenshot button triggers a capture without throwing', async ({ page }) => {
    const pageErrors = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));

    await page.locator('#tb-screenshot').click();
    await page.waitForTimeout(500);

    expect(pageErrors, pageErrors.join('\n')).toEqual([]);
  });

  test('returns an error instead of throwing when the account is not open', async ({ page }) => {
    const result = await page.evaluate(() => window.api.captureScreenshot('not-a-real-account-id'));
    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
  });
});
