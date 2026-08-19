const fs = require('fs');
const http = require('http');
const path = require('path');
const { test, expect } = require('./fixtures');

const CHAT_PORT = 8939;
const HIDDEN_CHAT_PORT = 8942;

// Base implementation, not the finished feature — see CHAT_SITE_SELECTORS
// in translate.js. Only Dragon Ball Idle's real chat DOM has been
// confirmed live (via CDP inspection of an actual logged-in session), so
// this fixture (test/fixtures/dbz-chat.html) mirrors that exact structure
// byte-for-byte. Served over localhost, which translate.js's selector map
// also recognizes specifically so this real pipeline is testable at all —
// see the comment there for why that's safe. The webview's own DOM isn't
// reachable through Playwright's Electron support (same limitation noted
// throughout translate.spec.js), so these tests assert on the IPC-level
// result object (translated/seen counts) rather than the literal
// translated text.
test.describe('Chat auto-translate (per-message, per-user)', () => {
  let server;
  test.beforeAll(() => {
    const html = fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'dbz-chat.html'));
    server = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(html);
    });
    return new Promise((resolve) => server.listen(CHAT_PORT, resolve));
  });
  test.afterAll(() => new Promise((resolve) => server.close(resolve)));

  test('translates each chat message with its own detected language, and does not re-translate on a repeat call', async ({ page }) => {
    const active = (await page.evaluate(() => window.api.getState())).settings.activeAccountId;
    await page.evaluate(
      ({ id, port }) => window.api.navigateAccount(id, `http://localhost:${port}/`),
      { id: active, port: CHAT_PORT }
    );
    await expect.poll(async () => {
      const s = await page.evaluate(() => window.api.getState());
      return s.accounts.find((a) => a.id === active)?.url;
    }).toContain(`localhost:${CHAT_PORT}`);

    // Fixture has 4 messages: two from UserA (Portuguese), one from UserB
    // (Russian), and one from UserC (French) — the French one is a
    // regression check for a real bug hit live: franc detects it
    // confidently as 'fr', but Bergamot has no French model at all, and
    // feeding an unsupported language straight into translateBatch used to
    // throw and abort the WHOLE pass, silently losing the other 3
    // messages' perfectly good translations along with it. seen counts
    // all 4 (every .txt node gets looked at); translated only counts the
    // 3 that could actually go through a real model.
    const first = await page.evaluate((id) => window.api.translateChatOnce(id), active);
    expect(first.ok).toBe(true);
    expect(first.seen).toBe(4);
    expect(first.translated).toBe(3);

    // Repeat call, nothing new rendered since — extractChatMessagesScript's
    // __nexaChatKnownTxt WeakSet should skip every .txt node it already
    // processed, same dedup pattern as the selection-translate feature.
    const second = await page.evaluate((id) => window.api.translateChatOnce(id), active);
    expect(second.ok).toBe(true);
    expect(second.translated).toBe(0);
  });

  test('reports unsupported (not an error) on a domain with no known chat selectors', async ({ page }) => {
    const active = (await page.evaluate(() => window.api.getState())).settings.activeAccountId;
    await page.evaluate((id) => window.api.navigateAccount(id, 'https://example.com'), active);
    await expect.poll(async () => {
      const s = await page.evaluate(() => window.api.getState());
      return s.accounts.find((a) => a.id === active)?.url;
    }).toContain('example.com');

    const result = await page.evaluate((id) => window.api.translateChatOnce(id), active);
    expect(result.ok).toBe(true);
    expect(result.unsupported).toBe(true);
    expect(result.translated).toBe(0);
  });

  test('the chatAutoTranslate account flag persists through accounts:update and clears its history when turned off', async ({ page }) => {
    const active = (await page.evaluate(() => window.api.getState())).settings.activeAccountId;
    const on = await page.evaluate((id) => window.api.updateAccount(id, { chatAutoTranslate: true }), active);
    const account = on.accounts.find((a) => a.id === active);
    expect(account.chatAutoTranslate).toBe(true);

    const off = await page.evaluate((id) => window.api.updateAccount(id, { chatAutoTranslate: false }), active);
    expect(off.accounts.find((a) => a.id === active).chatAutoTranslate).toBe(false);
  });
});

test.describe('Chat auto-translate pauses when the panel is minimized', () => {
  let server;
  test.beforeAll(() => {
    const html = fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'dbz-chat-hidden.html'));
    server = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(html);
    });
    return new Promise((resolve) => server.listen(HIDDEN_CHAT_PORT, resolve));
  });
  test.afterAll(() => new Promise((resolve) => server.close(resolve)));

  test('does no translation work while the chat container is display:none, same as a real minimized panel', async ({ page }) => {
    // Both real games this was confirmed against (Dragon Ball Idle and
    // Poke Idle World) can minimize/close their chat panel via their own
    // UI without removing the messages from the DOM — just hiding them
    // via CSS. Translating messages nobody can see wastes real WASM/CPU
    // work, so extractChatMessagesScript bails out before doing anything
    // if the first matched message has zero rendered size.
    const active = (await page.evaluate(() => window.api.getState())).settings.activeAccountId;
    await page.evaluate(
      ({ id, port }) => window.api.navigateAccount(id, `http://localhost:${port}/`),
      { id: active, port: HIDDEN_CHAT_PORT }
    );
    await expect.poll(async () => {
      const s = await page.evaluate(() => window.api.getState());
      return s.accounts.find((a) => a.id === active)?.url;
    }).toContain(`localhost:${HIDDEN_CHAT_PORT}`);

    const result = await page.evaluate((id) => window.api.translateChatOnce(id), active);
    expect(result.ok).toBe(true);
    expect(result.translated).toBe(0);
    expect(result.hidden).toBe(true);
  });
});
