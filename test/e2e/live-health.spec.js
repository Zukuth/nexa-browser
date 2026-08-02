const { test, expect } = require('./fixtures');

test.describe('live health', () => {
  test('boots cleanly and keeps the shell state reactive', async ({ page }) => {
    const pageErrors = [];
    const consoleErrors = [];

    page.on('pageerror', (err) => {
      pageErrors.push(err.message);
    });

    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await expect(page.locator('#space-name')).toHaveText('General');
    await expect(page.locator('.account-item')).toHaveCount(1);
    await expect(page.locator('#status-space-info')).toContainText('General');
    await expect(page.locator('#status-space-info')).toContainText('1');
    await expect(page.locator('#status-active-account')).not.toHaveText('');
    await expect(page.locator('#status-version')).not.toHaveText('');

    const meta = await page.evaluate(() => window.api.getMeta());
    const state = await page.evaluate(() => window.api.getState());
    expect(meta.version).toBeTruthy();
    expect(['grid', 'single', 'columns', 'rows', 'free']).toContain(state.settings.layoutMode);

    const initialClock = (await page.locator('#status-time').textContent()) || '';
    await page.waitForTimeout(1200);
    await expect(page.locator('#status-time')).not.toHaveText(initialClock);

    await page.locator('#btn-new-tab').click();
    await expect(page.locator('.account-item')).toHaveCount(2);

    await page.locator('#btn-layout-menu').click();
    await page.locator('.layout-option[data-mode="columns"]').click();

    await expect(page.locator('#status-space-info')).toContainText('Columnas');
    await expect(page.locator('.panel-header')).toHaveCount(2);
    await expect.poll(async () => {
      const current = await page.evaluate(() => window.api.getState());
      return current.settings.layoutMode;
    }).toBe('columns');

    expect(pageErrors, pageErrors.join('\n')).toEqual([]);
    expect(consoleErrors, consoleErrors.join('\n')).toEqual([]);
  });

  test('updates the visible clock after the app has been idle for a moment', async ({ page }) => {
    const start = (await page.locator('#status-time').textContent()) || '';
    await page.waitForTimeout(1200);
    await expect(page.locator('#status-time')).not.toHaveText(start);
  });
});
