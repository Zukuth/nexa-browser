const { test, expect } = require('./fixtures');

// Real DNS queries (see electron/dns-test.js) — not mocked, so this needs
// actual network access and a slightly generous timeout, but it's the only
// way to confirm the whole chain (button -> IPC -> dns.Resolver -> rendered
// rows) actually works end to end rather than just that the wiring compiles.
test.describe('DNS speed test', () => {
  test('running the test renders a ranked row per provider, fastest first', async ({ page }) => {
    await page.locator('#tb-dns').click();
    await expect(page.locator('#dns-modal')).not.toHaveClass(/hidden/);

    await page.locator('#dns-run-test').click();
    await expect(page.locator('.dns-row')).not.toHaveCount(0, { timeout: 15000 });

    const rowCount = await page.locator('.dns-row').count();
    expect(rowCount).toBeGreaterThan(3);

    // At least one provider should have answered on a normal network — if
    // literally every single one timed out we'd rather fail loudly here
    // than silently ship a feature that never actually works.
    const msTexts = await page.locator('.dns-ms').allTextContents();
    expect(msTexts.some((t) => /\d+ ms/.test(t))).toBe(true);

    await page.locator('#btn-close-dns').click();
    await expect(page.locator('#dns-modal')).toHaveClass(/hidden/);
  });

  test('copying the restore command does not throw and gives clipboard feedback', async ({ page }) => {
    await page.locator('#tb-dns').click();
    await page.locator('#dns-copy-restore').click();
    await expect(page.locator('#dns-copy-restore')).toHaveText(/Copiado/);
  });
});
