const { test, expect } = require('./fixtures');

// QA sweep additions (2026-08-08): fills gaps the existing e2e specs don't
// cover yet — global error capture, invalid/search-like address-bar input,
// and a repeated open/close stress pass with a memory-growth sanity check.
// Kept as its own file instead of folding into accounts.spec.js/
// live-health.spec.js so it's easy to run or delete on its own.
test.describe('QA audit — global error capture (host UI)', () => {
  test('an uncaught exception in the host chrome UI reaches the main process log', async ({ page, electronApp }) => {
    const logLines = [];
    electronApp.process().stdout.on('data', (chunk) => logLines.push(chunk.toString()));
    electronApp.process().stderr.on('data', (chunk) => logLines.push(chunk.toString()));

    await page.evaluate(() => {
      setTimeout(() => { throw new Error('QA-AUDIT-DELIBERATE-ERROR'); }, 0);
    });
    await page.waitForTimeout(300);

    expect(logLines.join('')).toContain('[renderer-error]');
    expect(logLines.join('')).toContain('QA-AUDIT-DELIBERATE-ERROR');
  });

  test('an unhandled promise rejection in the host chrome UI reaches the main process log', async ({ page, electronApp }) => {
    const logLines = [];
    electronApp.process().stdout.on('data', (chunk) => logLines.push(chunk.toString()));
    electronApp.process().stderr.on('data', (chunk) => logLines.push(chunk.toString()));

    await page.evaluate(() => {
      Promise.reject(new Error('QA-AUDIT-DELIBERATE-REJECTION'));
    });
    await page.waitForTimeout(300);

    expect(logLines.join('')).toContain('[renderer-error]');
    expect(logLines.join('')).toContain('QA-AUDIT-DELIBERATE-REJECTION');
  });
});

test.describe('QA audit — address bar edge cases', () => {
  test('typing a plain search phrase (no protocol, contains spaces) falls back to a search engine instead of a broken URL', async ({ page }) => {
    const pageErrors = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));

    await page.locator('#input-address').fill('hello world');
    await page.locator('#input-address').press('Enter');
    await page.waitForTimeout(500);

    const state = await page.evaluate(() => window.api.getState());
    const account = state.accounts.find((a) => !a.closed);
    // Fixed 2026-08-08 (see electron/address-bar.js): used to produce the
    // literal broken URL "https://hello world". Now falls back to a real
    // search instead of a dead navigation.
    expect(account.url).toBe('https://www.google.com/search?q=hello%20world');
    expect(pageErrors, pageErrors.join('\n')).toEqual([]);
  });

  test('an empty address bar submit is a no-op, not a crash', async ({ page }) => {
    const pageErrors = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));

    // Pin a known URL first instead of trusting whatever the auto-created
    // first account's default happened to settle on — that default races
    // against this fixture's own about:blank override (a pre-existing gap,
    // not something this test should depend on) and can flap between
    // 'about:blank' and the real app default depending on timing.
    const active = (await page.evaluate(() => window.api.getState())).settings.activeAccountId;
    await page.evaluate((id) => window.api.navigateAccount(id, 'about:blank'), active);
    await expect.poll(async () => {
      const s = await page.evaluate(() => window.api.getState());
      return s.accounts.find((a) => a.id === active)?.url;
    }).toBe('about:blank');

    const before = await page.evaluate(() => window.api.getState());
    await page.locator('#input-address').fill('   ');
    await page.locator('#input-address').press('Enter');
    await page.waitForTimeout(300);

    const after = await page.evaluate(() => window.api.getState());
    expect(after.accounts.map((a) => a.url)).toEqual(before.accounts.map((a) => a.url));
    expect(pageErrors, pageErrors.join('\n')).toEqual([]);
  });

  test('a very long URL does not crash the app or the address bar', async ({ page }) => {
    const pageErrors = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));

    const longUrl = 'https://example.com/' + 'a'.repeat(8000);
    await page.locator('#input-address').fill(longUrl);
    await page.locator('#input-address').press('Enter');
    await page.waitForTimeout(500);

    expect(pageErrors, pageErrors.join('\n')).toEqual([]);
    // App must still be responsive — a fresh account can still be added.
    await page.locator('#btn-new-tab').click();
    await expect(page.locator('.account-item')).toHaveCount(2);
  });
});

test.describe('QA audit — repeated open/close stress', () => {
  test('opening and closing 20 accounts in a row does not corrupt sidebar state or leak unbounded memory', async ({ page, electronApp }) => {
    const pageErrors = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));

    const metricsBefore = await electronApp.evaluate(({ app }) => {
      const m = app.getAppMetrics().find((p) => p.type === 'Browser');
      return m ? m.memory.workingSetSize : 0;
    });

    for (let i = 0; i < 20; i++) {
      await page.locator('#btn-new-tab').click();
      await expect(page.locator('.account-item')).toHaveCount(2);
      const item = page.locator('.account-item').nth(1);
      await item.hover();
      await item.locator('.account-remove').dispatchEvent('click');
      await expect(page.locator('.account-item')).toHaveCount(1);
    }

    const metricsAfter = await electronApp.evaluate(({ app }) => {
      const m = app.getAppMetrics().find((p) => p.type === 'Browser');
      return m ? m.memory.workingSetSize : 0;
    });

    const growthMb = (metricsAfter - metricsBefore) / 1024;
    console.log(`[qa-audit] main process working set growth after 20 open/close cycles: ${growthMb.toFixed(1)}MB`);

    expect(pageErrors, pageErrors.join('\n')).toEqual([]);
    // Generous ceiling — this is a sanity guard against unbounded growth, not
    // a tight perf budget (about:blank accounts only, no real page content).
    expect(growthMb).toBeLessThan(150);
  });

  test('rapid-fire navigation (spamming a new URL before the previous one settles) does not crash or desync state', async ({ page }) => {
    const pageErrors = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));

    const urls = [
      'https://example.com/',
      'https://example.org/',
      'about:blank',
      'https://example.net/',
      'about:blank'
    ];
    for (const url of urls) {
      await page.locator('#input-address').fill(url);
      await page.locator('#input-address').press('Enter');
      await page.waitForTimeout(60); // deliberately shorter than a real page load
    }
    await page.waitForTimeout(1000);

    const state = await page.evaluate(() => window.api.getState());
    const account = state.accounts.find((a) => !a.closed);
    expect(account.url).toBe(urls[urls.length - 1]);
    expect(pageErrors, pageErrors.join('\n')).toEqual([]);
  });
});
