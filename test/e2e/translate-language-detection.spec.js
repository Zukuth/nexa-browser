const fs = require('fs');
const http = require('http');
const path = require('path');
const { test, expect } = require('./fixtures');

const HTTP_PORT = 8932;
const FIXTURE = path.join(__dirname, '..', 'fixtures', 'no-lang-spanish.html');

// franc-min content-based detection (see translate.js's detectLanguage) —
// only used when a page has no <html lang> at all, which is what this
// fixture deliberately omits. Every other translate test uses pages that
// DO declare lang (example.com has lang="en"), so this is the only one that
// actually exercises the detection fallback rather than the direct path.
test.describe('Translation language detection fallback', () => {
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

  test('detects Spanish from page content when no lang attribute is declared', async ({ page }) => {
    const active = (await page.evaluate(() => window.api.getState())).settings.activeAccountId;
    await page.evaluate(
      ({ id, port }) => window.api.navigateAccount(id, `http://localhost:${port}`),
      { id: active, port: HTTP_PORT }
    );
    await expect.poll(async () => {
      const s = await page.evaluate(() => window.api.getState());
      return s.accounts.find((a) => a.id === active)?.url;
    }).toContain(`localhost:${HTTP_PORT}`);

    const result = await page.evaluate((id) => window.api.translatePage(id, 'en'), active);
    expect(result.ok).toBe(true);
    expect(result.from).toBe('es');
    expect(result.to).toBe('en');
    expect(result.translated).toBeGreaterThan(0);
  });
});
