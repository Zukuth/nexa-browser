const { test, expect } = require('./fixtures');

test.describe('spaces', () => {
  test('creating a space switches to it, and its account list is independent from the original space', async ({ page }) => {
    await expect(page.locator('#space-name')).toHaveText('General');
    await expect(page.locator('.account-item')).toHaveCount(1); // the auto-added account in "General"

    await page.locator('#btn-add-space').click();

    // Adding a space activates it immediately.
    await expect(page.locator('#space-name')).toHaveText('Espacio 2');
    await expect(page.locator('#rail-spaces .space-icon')).toHaveCount(2);
    // Brand-new space has no accounts of its own yet.
    await expect(page.locator('.account-item')).toHaveCount(0);
    await expect(page.locator('#empty-state')).toBeVisible();
  });

  test('switching back to a space via the rail restores its own accounts', async ({ page }) => {
    await page.locator('#btn-new-tab').click();
    await expect(page.locator('.account-item')).toHaveCount(2); // still in "General"

    await page.locator('#btn-add-space').click();
    await expect(page.locator('#space-name')).toHaveText('Espacio 2');
    await expect(page.locator('.account-item')).toHaveCount(0);

    await page.locator('#rail-spaces .space-icon[title="General"]').click();

    await expect(page.locator('#space-name')).toHaveText('General');
    await expect(page.locator('.account-item')).toHaveCount(2);
  });
});
