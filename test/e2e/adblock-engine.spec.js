const fs = require('fs');
const http = require('http');
const path = require('path');
const { test, expect } = require('./fixtures');

const HTTP_PORT = 8933;
const FIXTURE = path.join(__dirname, '..', 'fixtures', 'ad-domain-probe.html');

// Confirms the real filter engine (@ghostery/adblocker-electron, see
// applyAdBlock in main.js) actually blocks a known ad domain end to end —
// not just that the settings UI persists a protectionLevel value. The
// engine loads asynchronously after first paint (loadAdBlockEngine), so
// this polls metrics:get rather than asserting immediately.
test.describe('Ad blocking engine', () => {
  test.describe.configure({ mode: 'serial' });
  let server;
  test.beforeAll(() => {
    const html = fs.readFileSync(FIXTURE);
    server = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(html);
    });
    return new Promise((resolve) => server.listen(HTTP_PORT, resolve));
  });
  test.afterAll(() => new Promise((resolve) => server.close(resolve)));

  test('blocks a real ad-domain resource request and counts it', async ({ page }) => {
    // Wait for the real filter engine (not the small startup fallback list —
    // see ADBLOCK_STARTUP_FALLBACK in main.js) so this exercises the actual
    // thing being verified, not the safety net that covers the loading gap.
    await expect.poll(() => page.evaluate(() => window.api.isAdBlockEngineReady()), { timeout: 20000 }).toBe(true);

    const active = (await page.evaluate(() => window.api.getState())).settings.activeAccountId;
    await page.evaluate(
      ({ id, port }) => window.api.navigateAccount(id, `http://localhost:${port}`),
      { id: active, port: HTTP_PORT }
    );
    await expect.poll(async () => {
      const s = await page.evaluate(() => window.api.getState());
      return s.accounts.find((a) => a.id === active)?.url;
    }).toContain(`localhost:${HTTP_PORT}`);

    await expect.poll(async () => {
      const metrics = await page.evaluate(() => window.api.getMetrics());
      return metrics[active]?.blocked || 0;
    }, { timeout: 20000 }).toBeGreaterThan(0);
  });

  test('protectionLevel off lets the same resource through unblocked', async ({ page }) => {
    await page.evaluate(() => window.api.updateSettings({ protectionLevel: 'off' }));
    const active = (await page.evaluate(() => window.api.getState())).settings.activeAccountId;
    await page.evaluate(
      ({ id, port }) => window.api.navigateAccount(id, `http://localhost:${port}`),
      { id: active, port: HTTP_PORT }
    );
    await expect.poll(async () => {
      const s = await page.evaluate(() => window.api.getState());
      return s.accounts.find((a) => a.id === active)?.url;
    }).toContain(`localhost:${HTTP_PORT}`);

    // Give it the same window the positive test needed, then confirm it
    // never incremented — a real behavioral check, not just "didn't error".
    await page.waitForTimeout(3000);
    const metrics = await page.evaluate(() => window.api.getMetrics());
    expect(metrics[active]?.blocked || 0).toBe(0);
  });
});
