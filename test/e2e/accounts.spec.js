const { test, expect, closeAccountAt } = require('./fixtures');

test.describe('accounts', () => {
  test('opening a new account adds it to the sidebar and makes it the active panel', async ({ page }) => {
    await expect(page.locator('#empty-state')).toBeHidden();
    await expect(page.locator('.account-item')).toHaveCount(1);

    await page.locator('#btn-new-tab').click();

    await expect(page.locator('.account-item')).toHaveCount(2);
    const newItem = page.locator('.account-item').nth(1);
    await expect(newItem).toHaveClass(/active/);
    await expect(newItem.locator('.account-name')).toHaveText('Pestaña 2');

    // The new account also becomes the single visible panel.
    await expect(page.locator('.panel-header')).toHaveCount(1);
  });

  test('adding an account from the empty state works the same way', async ({ page }) => {
    // Start from a clean slate: close the one auto-created account first.
    await closeAccountAt(page, 0);
    await expect(page.locator('.account-item')).toHaveCount(0);
    await expect(page.locator('#empty-state')).toBeVisible();

    await page.locator('#btn-empty-add').click();

    await expect(page.locator('.account-item')).toHaveCount(1);
    await expect(page.locator('#empty-state')).toBeHidden();
  });

  test('closing an account removes it from the sidebar and its panel', async ({ page }) => {
    await page.locator('#btn-new-tab').click();
    await expect(page.locator('.account-item')).toHaveCount(2);

    // Adding an account switches layout back to "single" (only the active panel is
    // shown) — switch to grid so both panels are actually visible at once.
    await page.locator('#btn-layout-menu').click();
    await page.locator('.layout-option[data-mode="grid"]').click();
    await expect(page.locator('.panel-header')).toHaveCount(2);

    // account-item display names are positional ("Pestaña <index+1>"), not stable
    // per-account labels, so identify the survivor by id rather than by name.
    const stateBefore = await page.evaluate(() => window.api.getState());
    const secondAccountId = stateBefore.accounts[1].id;

    // Close the first account — the second should remain.
    await closeAccountAt(page, 0);

    await expect(page.locator('.account-item')).toHaveCount(1);
    await expect(page.locator('.panel-header')).toHaveCount(1);
    const stateAfter = await page.evaluate(() => window.api.getState());
    expect(stateAfter.accounts.map((a) => a.id)).toEqual([secondAccountId]);
  });

  test('closing the last account returns to the empty state', async ({ page }) => {
    await closeAccountAt(page, 0);

    await expect(page.locator('.account-item')).toHaveCount(0);
    await expect(page.locator('.panel-header')).toHaveCount(0);
    await expect(page.locator('#empty-state')).toBeVisible();
  });

  // Regression test for B-01: closing and reopening accounts must not corrupt
  // state (e.g. duplicate event listeners causing double download records).
  test('closing and reopening accounts does not corrupt sidebar state', async ({ page }) => {
    // Open a second account so there is a survivor when we close the first.
    await page.locator('#btn-new-tab').click();
    await expect(page.locator('.account-item')).toHaveCount(2);

    const stateBefore = await page.evaluate(() => window.api.getState());
    const survivorId = stateBefore.accounts[1].id;

    // Close the first account.
    await closeAccountAt(page, 0);
    await expect(page.locator('.account-item')).toHaveCount(1);

    // The survivor is intact and is the only account in state.
    const stateAfter = await page.evaluate(() => window.api.getState());
    expect(stateAfter.accounts).toHaveLength(1);
    expect(stateAfter.accounts[0].id).toBe(survivorId);

    // Reopening a new account from a single-account state must work cleanly.
    await page.locator('#btn-new-tab').click();
    await expect(page.locator('.account-item')).toHaveCount(2);
    await expect(page.locator('.panel-header')).toHaveCount(1);

    const stateFinal = await page.evaluate(() => window.api.getState());
    // No duplicate account ids — every id must be unique.
    const ids = stateFinal.accounts.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
