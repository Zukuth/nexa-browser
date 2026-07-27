const { test, expect, stableBoundingBox } = require('./fixtures');

test.describe('panel drag-resize', () => {
  test('dragging the split divider resizes both neighboring panels and persists the split', async ({ page }) => {
    // Get to 2 open accounts, side by side in "columns" mode.
    await page.locator('#btn-new-tab').click();
    await expect(page.locator('.account-item')).toHaveCount(2);

    await page.locator('#btn-layout-menu').click();
    await page.locator('.layout-option[data-mode="columns"]').click();

    const panels = page.locator('.panel-header');
    await expect(panels).toHaveCount(2);
    const divider = page.locator('.split-divider-v');
    await expect(divider).toHaveCount(1);

    const beforeA = await stableBoundingBox(panels.nth(0));
    const beforeB = await stableBoundingBox(panels.nth(1));
    // Equal split (neither account has dragged a divider before) — same width, +-1px rounding.
    expect(Math.abs(beforeA.width - beforeB.width)).toBeLessThan(2);

    const dividerBox = await stableBoundingBox(divider);
    const dragBy = 180;
    const startX = dividerBox.x + dividerBox.width / 2;
    const startY = dividerBox.y + dividerBox.height / 2;

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + dragBy, startY, { steps: 10 });
    await page.mouse.up();

    const afterA = await stableBoundingBox(panels.nth(0));
    const afterB = await stableBoundingBox(panels.nth(1));
    expect(afterA.width).toBeGreaterThan(beforeA.width + dragBy - 20);
    expect(afterB.width).toBeLessThan(beforeB.width - dragBy + 20);

    // The resize is persisted as widthFrac on the accounts, not just a visual drag.
    await expect.poll(async () => {
      const state = await page.evaluate(() => window.api.getState());
      const spaceAccounts = state.accounts.filter((a) => a.spaceId === 'default');
      return spaceAccounts.every((a) => typeof a.widthFrac === 'number' && a.widthFrac > 0);
    }).toBe(true);

    const state = await page.evaluate(() => window.api.getState());
    const spaceAccounts = state.accounts.filter((a) => a.spaceId === 'default');
    expect(Math.abs(spaceAccounts[0].widthFrac - spaceAccounts[1].widthFrac)).toBeGreaterThan(0.1);
  });

  test('dragging the horizontal split divider resizes panels stacked in "rows" mode', async ({ page }) => {
    await page.locator('#btn-new-tab').click();
    await expect(page.locator('.account-item')).toHaveCount(2);

    await page.locator('#btn-layout-menu').click();
    await page.locator('.layout-option[data-mode="rows"]').click();

    const panels = page.locator('.panel-header');
    await expect(panels).toHaveCount(2);
    const divider = page.locator('.split-divider-h');
    await expect(divider).toHaveCount(1);

    // Each panel-header is a fixed-height (30px) title strip pinned to the top of its
    // row, not the full row — dragging the divider moves *where that strip sits*
    // (its y position), not its own height. Row 1's header always starts at the same
    // y; row 2's header y is pushed down as row 1 grows taller.
    const beforeA = await stableBoundingBox(panels.nth(0));
    const beforeB = await stableBoundingBox(panels.nth(1));

    const dividerBox = await stableBoundingBox(divider);
    const dragBy = 120;
    const startX = dividerBox.x + dividerBox.width / 2;
    const startY = dividerBox.y + dividerBox.height / 2;

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX, startY + dragBy, { steps: 10 });
    await page.mouse.up();

    const afterA = await stableBoundingBox(panels.nth(0));
    const afterB = await stableBoundingBox(panels.nth(1));
    expect(Math.abs(afterA.y - beforeA.y)).toBeLessThan(2);
    expect(afterB.y).toBeGreaterThan(beforeB.y + dragBy - 20);

    await expect.poll(async () => {
      const state = await page.evaluate(() => window.api.getState());
      const spaceAccounts = state.accounts.filter((a) => a.spaceId === 'default');
      return spaceAccounts.every((a) => typeof a.heightFrac === 'number' && a.heightFrac > 0);
    }).toBe(true);
  });
});
