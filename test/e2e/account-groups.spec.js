const { test, expect } = require('./fixtures');

// Browser-inspired idea #11 — collapsible account sub-groups within a Space
// (see groups:create/groups:toggleCollapsed/accounts:setGroup in main.js).
test.describe('Collapsible account groups', () => {
  test('creating a group and assigning an account renders a collapsible header', async ({ page }) => {
    const state = await page.evaluate(() => window.api.getState());
    const spaceId = state.settings.currentSpaceId;
    const accountId = state.settings.activeAccountId;

    const group = await page.evaluate((sid) => window.api.createGroup(sid, 'Farmeo'), spaceId);
    expect(group.name).toBe('Farmeo');
    expect(group.collapsed).toBe(false);

    await page.evaluate(({ id, groupId }) => window.api.setAccountGroup(id, groupId), { id: accountId, groupId: group.id });

    await expect(page.locator('.account-group-header')).toHaveCount(1);
    await expect(page.locator('.account-group-header .group-name')).toHaveText('Farmeo');
    await expect(page.locator('.account-group-header .group-count')).toHaveText('1');

    // The grouped account still renders (group starts expanded).
    await expect(page.locator('.account-item')).toHaveCount(1);

    // Collapsing hides the account but keeps the header.
    await page.locator('.account-group-header').click();
    await expect.poll(async () => {
      const s = await page.evaluate(() => window.api.getState());
      return s.groups.find((g) => g.id === group.id)?.collapsed;
    }).toBe(true);
    await expect(page.locator('.account-item')).toHaveCount(0);
    await expect(page.locator('.account-group-header')).toHaveCount(1);

    // Expanding again brings it back.
    await page.locator('.account-group-header').click();
    await expect(page.locator('.account-item')).toHaveCount(1);
  });

  test('removing a group ungroups its accounts instead of deleting them', async ({ page }) => {
    const state = await page.evaluate(() => window.api.getState());
    const spaceId = state.settings.currentSpaceId;
    const accountId = state.settings.activeAccountId;

    const group = await page.evaluate((sid) => window.api.createGroup(sid, 'Temporal'), spaceId);
    await page.evaluate(({ id, groupId }) => window.api.setAccountGroup(id, groupId), { id: accountId, groupId: group.id });
    await expect(page.locator('.account-group-header')).toHaveCount(1);

    await page.evaluate((id) => window.api.removeGroup(id), group.id);

    await expect(page.locator('.account-group-header')).toHaveCount(0);
    await expect(page.locator('.account-item')).toHaveCount(1);

    const finalState = await page.evaluate(() => window.api.getState());
    expect(finalState.accounts.find((a) => a.id === accountId)?.groupId).toBeFalsy();
    expect(finalState.groups.find((g) => g.id === group.id)).toBeUndefined();
  });
});
