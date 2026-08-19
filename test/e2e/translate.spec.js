const fs = require('fs');
const http = require('http');
const path = require('path');
const { test, expect } = require('./fixtures');
const { createTwoPagesServer } = require('../fixtures/two-pages-server');

const TWO_PAGES_PORT = 8935;
const TOOLTIP_ALT_PORT = 8937;
const SELECTION_PORT = 8938;
const OVERLAY_PORT = 8941;

// Real translation, not mocked — this needs to actually download the
// language model once (see electron/translate.js) and run it through the
// Bergamot WASM engine, so it gets a generous timeout. The webview's own DOM
// isn't reachable through Playwright's Electron support (see
// picture-in-picture.spec.js's note on the same limitation), so the
// translated *text* itself can't be asserted on here — but the toolbar
// button, the progress modal and the neon-green "translated" marker all
// live in the host UI, which is, so this exercises the real click path
// (button -> IPC -> webview executeJavaScript -> Bergamot -> UI feedback)
// rather than just calling window.api directly.
test.describe('Page translation', () => {
  test('clicking the toolbar button translates the page, shows progress, and toggles the neon marker', async ({ page }) => {
    const active = (await page.evaluate(() => window.api.getState())).settings.activeAccountId;

    // example.com rather than a data: URL: address-bar.js's
    // normalizeAddressInput() only passes http(s)/about: URLs through
    // unchanged (everything else, including data:/file:, falls back to a
    // Google search — see its own comment), and example.com is the
    // established neutral placeholder used elsewhere in this project (its
    // "Example Domain" text is real, static, English content with no
    // third-party/game artwork).
    await page.evaluate(
      (id) => window.api.navigateAccount(id, 'https://example.com'),
      active
    );
    await expect.poll(async () => {
      const s = await page.evaluate(() => window.api.getState());
      return s.accounts.find((a) => a.id === active)?.url;
    }).toContain('example.com');

    await expect(page.locator('#tb-translate')).not.toHaveClass(/translated/);

    await page.locator('#tb-translate').click();
    await expect(page.locator('#translate-modal')).not.toHaveClass(/hidden/);

    // Progress modal fills up to 100% and closes itself on success.
    await expect(page.locator('#translate-progress-label')).toHaveText('100%', { timeout: 30000 });
    await expect(page.locator('#translate-modal')).toHaveClass(/hidden/, { timeout: 5000 });

    await expect(page.locator('#tb-translate')).toHaveClass(/translated/);

    // Clicking again restores the original page and clears the marker.
    await page.locator('#tb-translate').click();
    await expect(page.locator('#tb-translate')).not.toHaveClass(/translated/);
  });

  test('translating text via IPC reports fragment counts and language pair', async ({ page }) => {
    const active = (await page.evaluate(() => window.api.getState())).settings.activeAccountId;
    await page.evaluate((id) => window.api.navigateAccount(id, 'https://example.com'), active);
    await expect.poll(async () => {
      const s = await page.evaluate(() => window.api.getState());
      return s.accounts.find((a) => a.id === active)?.url;
    }).toContain('example.com');

    const result = await page.evaluate((id) => window.api.translatePage(id, 'es'), active);
    expect(result.ok).toBe(true);
    expect(result.translated).toBeGreaterThan(0);
    expect(result.from).toBe('en');
    expect(result.to).toBe('es');

    const restored = await page.evaluate((id) => window.api.restorePage(id), active);
    expect(restored.ok).toBe(true);
  });

  test('calling translatePage again on an already-translated page does not re-translate everything', async ({ page }) => {
    // Confirmed live against a real game: re-running full extraction on a
    // page that's already translated re-walks and re-translates text
    // that's ALREADY in the target language, and translating already-
    // translated text a second time through the pt/en pivot doesn't
    // reproduce the same correct answer — it corrupts it ("Impulso de
    // daños" came back as "Implora de daños"). performTranslate's fix:
    // once translateWatching already has this page, a repeat call only
    // drains genuinely-new pending nodes instead of re-extracting
    // everything, so with nothing new on the page the second call should
    // report 0 fragments translated, not the same count as the first.
    const active = (await page.evaluate(() => window.api.getState())).settings.activeAccountId;
    await page.evaluate((id) => window.api.navigateAccount(id, 'https://example.com'), active);
    await expect.poll(async () => {
      const s = await page.evaluate(() => window.api.getState());
      return s.accounts.find((a) => a.id === active)?.url;
    }).toContain('example.com');

    const first = await page.evaluate((id) => window.api.translatePage(id, 'es'), active);
    expect(first.ok).toBe(true);
    expect(first.translated).toBeGreaterThan(0);

    const second = await page.evaluate((id) => window.api.translatePage(id, 'es'), active);
    expect(second.ok).toBe(true);
    expect(second.translated).toBe(0);

    const restored = await page.evaluate((id) => window.api.restorePage(id), active);
    expect(restored.ok).toBe(true);
  });

  test('the very first translation of a language pair actually downloads and caches real model files', async ({ page }) => {
    // Verifies the download itself happened (new files appear in the shared
    // on-disk model cache — see translator.js's patched fetch()) rather than
    // asserting on the live translate:downloadProgress IPC event, which
    // proved to fire unreliably specifically inside Playwright's Electron
    // harness (confirmed working when called directly via a plain `node -e`
    // script against electron/translate.js — this is an environment quirk
    // of the test harness, not the feature itself, and wasn't worth chasing
    // further at the cost of everything else still waiting to be fixed).
    // The cache is shared (and meant to be — same real userData-style
    // location every launch of the real app uses) across every test and
    // every run of this suite, not just within one run. Snapshotting
    // "before" only tells us anything if the pair genuinely isn't cached
    // yet, which stops being true the moment any earlier run (or earlier
    // manual testing) has ever translated en->fr — confirmed this actually
    // happened during development of this feature. Clearing the whole
    // cache dir first removes that history dependency entirely; the app
    // re-seeds its bundled pt<->en/en<->es pairs on its own next launch
    // (see translate.seedBundledModels in main.js), so this doesn't affect
    // anything this test doesn't itself exercise.
    const cacheDir = path.join(require('os').tmpdir(), 'nexa-bergamot-cache');
    fs.rmSync(cacheDir, { recursive: true, force: true });

    const active = (await page.evaluate(() => window.api.getState())).settings.activeAccountId;
    await page.evaluate((id) => window.api.navigateAccount(id, 'https://example.com'), active);
    await expect.poll(async () => {
      const s = await page.evaluate(() => window.api.getState());
      return s.accounts.find((a) => a.id === active)?.url;
    }).toContain('example.com');

    // 'fr' (French) — outside the bundled pt<->en/en<->es pairs, so it can
    // only get cached by a real download, which is exactly what this test
    // needs to force in order to verify.
    const result = await page.evaluate((id) => window.api.translatePage(id, 'fr'), active);
    expect(result.ok).toBe(true);

    expect(fs.existsSync(cacheDir)).toBe(true);
    expect(fs.readdirSync(cacheDir).length).toBeGreaterThan(0);
  });

  test.describe('auto-reapplies after a real navigation', () => {
    let server;
    test.beforeAll(async () => { server = await createTwoPagesServer(TWO_PAGES_PORT); });
    test.afterAll(() => new Promise((resolve) => server.close(resolve)));

    test('translating one page, then navigating to a different page, translates the new page without a manual click', async ({ page }) => {
      await page.evaluate(() => {
        window.__autoAppliedEvents = [];
        window.api.onTranslateAutoApplied((data) => window.__autoAppliedEvents.push(data));
      });

      const active = (await page.evaluate(() => window.api.getState())).settings.activeAccountId;
      await page.evaluate(
        ({ id, port }) => window.api.navigateAccount(id, `http://localhost:${port}/`),
        { id: active, port: TWO_PAGES_PORT }
      );
      await expect.poll(async () => {
        const s = await page.evaluate(() => window.api.getState());
        return s.accounts.find((a) => a.id === active)?.url;
      }).toContain(`localhost:${TWO_PAGES_PORT}`);

      await page.locator('#tb-translate').click();
      await expect(page.locator('#translate-progress-label')).toHaveText('100%', { timeout: 30000 });
      await expect(page.locator('#translate-modal')).toHaveClass(/hidden/, { timeout: 5000 });
      await expect(page.locator('#tb-translate')).toHaveClass(/translated/);

      // Real navigation to a different path — did-navigate, not
      // did-navigate-in-page — is what main.js's translationEnabled
      // auto-reapply logic (see performTranslate/did-finish-load) is meant
      // to survive.
      await page.evaluate(
        ({ id, port }) => window.api.navigateAccount(id, `http://localhost:${port}/second`),
        { id: active, port: TWO_PAGES_PORT }
      );
      await expect.poll(async () => {
        const s = await page.evaluate(() => window.api.getState());
        return s.accounts.find((a) => a.id === active)?.url;
      }).toContain('/second');

      // No click here — this is the thing being verified: it should
      // translate itself. Checked via the translate:autoApplied event
      // rather than the toolbar icon's class alone: the icon would already
      // show .translated from the FIRST page's (unrelated) success, so on
      // its own it can't prove the second page was actually retranslated.
      await expect.poll(async () => {
        const events = await page.evaluate(() => window.__autoAppliedEvents);
        return events.some((e) => e.id === active);
      }, { timeout: 15000 }).toBe(true);
    });
  });

  test.describe('translates tooltips and image alt text', () => {
    let server;
    test.beforeAll(() => {
      const html = fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'tooltip-alt-text.html'));
      server = http.createServer((req, res) => {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(html);
      });
      return new Promise((resolve) => server.listen(TOOLTIP_ALT_PORT, resolve));
    });
    test.afterAll(() => new Promise((resolve) => server.close(resolve)));

    test('extraction picks up the title= tooltip and img alt=, not just the paragraph', async ({ page }) => {
      // The webview's own DOM isn't reachable through Playwright's Electron
      // support (see this file's header comment), so this asserts on the
      // FRAGMENT COUNT rather than the literal translated string: the
      // fixture has one text-node paragraph, one button whose own visible
      // label is a second text node, one title= tooltip, and one img alt=
      // — 4 total. If extractPageTextScript's attribute walk (added for
      // tooltip/alt coverage) weren't wired up, this would report 2
      // (just the paragraph + button label) instead of 4.
      const active = (await page.evaluate(() => window.api.getState())).settings.activeAccountId;
      await page.evaluate(
        ({ id, port }) => window.api.navigateAccount(id, `http://localhost:${port}/`),
        { id: active, port: TOOLTIP_ALT_PORT }
      );
      await expect.poll(async () => {
        const s = await page.evaluate(() => window.api.getState());
        return s.accounts.find((a) => a.id === active)?.url;
      }).toContain(`localhost:${TOOLTIP_ALT_PORT}`);

      const result = await page.evaluate((id) => window.api.translatePage(id, 'es'), active);
      expect(result.ok).toBe(true);
      expect(result.translated).toBe(4);

      const restored = await page.evaluate((id) => window.api.restorePage(id), active);
      expect(restored.ok).toBe(true);
    });
  });

  test.describe('right-click "translate this text" (scoped selection translate)', () => {
    let server;
    test.beforeAll(() => {
      const html = fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'selection-translate.html'));
      server = http.createServer((req, res) => {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(html);
      });
      return new Promise((resolve) => server.listen(SELECTION_PORT, resolve));
    });
    test.afterAll(() => new Promise((resolve) => server.close(resolve)));

    test('translates only the element under the given point, tracks it separately from the full-page flow, and restore clears that tracking', async ({ page }) => {
      const active = (await page.evaluate(() => window.api.getState())).settings.activeAccountId;
      await page.evaluate(
        ({ id, port }) => window.api.navigateAccount(id, `http://localhost:${port}/`),
        { id: active, port: SELECTION_PORT }
      );
      await expect.poll(async () => {
        const s = await page.evaluate(() => window.api.getState());
        return s.accounts.find((a) => a.id === active)?.url;
      }).toContain(`localhost:${SELECTION_PORT}`);

      // (15, 15) lands inside #target (fixed at top:10px; left:10px) —
      // #other sits at top:300px, well outside this point, so a nonzero
      // result here is only possible if the element-at-point lookup and
      // its text-node walk actually work.
      const first = await page.evaluate((id) => window.api.translateSelectionAt(id, 15, 15), active);
      expect(first.ok).toBe(true);
      expect(first.translated).toBe(1);

      // Same spot again, without restoring in between: extractElementAtPointScript's
      // __nexaSelectionKnown WeakSet should skip the already-tracked node,
      // proving this doesn't just blindly re-translate on every click.
      const second = await page.evaluate((id) => window.api.translateSelectionAt(id, 15, 15), active);
      expect(second.ok).toBe(true);
      expect(second.translated).toBe(0);

      const restored = await page.evaluate((id) => window.api.restoreTranslatedSelections(id), active);
      expect(restored.ok).toBe(true);

      // After restoring, the same spot is "new" again — proves restore
      // actually cleared __nexaSelectionKnown/__nexaSelectionOriginals
      // instead of just visually reverting the text.
      const third = await page.evaluate((id) => window.api.translateSelectionAt(id, 15, 15), active);
      expect(third.ok).toBe(true);
      expect(third.translated).toBe(1);
    });
  });

  test.describe('right-click translate survives a native hit-test miss', () => {
    let server;
    test.beforeAll(() => {
      const html = fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'overlay-hit-test.html'));
      server = http.createServer((req, res) => {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(html);
      });
      return new Promise((resolve) => server.listen(OVERLAY_PORT, resolve));
    });
    test.afterAll(() => new Promise((resolve) => server.close(resolve)));

    test('finds the real text underneath a full-viewport overlay that wins the native hit test', async ({ page }) => {
      // Reproduces a real bug confirmed live against a Phaser/WebGL game
      // (dragonballidle.online): document.elementFromPoint(x, y) returned
      // the game's full-screen <canvas> instead of the chat panel actually
      // visible on top of it — not a one-pixel miss, EVERY point across the
      // panel's whole bounding box hit the canvas instead. This fixture's
      // #overlay reproduces the same failure mode (a transparent,
      // zero-content element winning the hit test) without needing an
      // actual game engine: extractElementAtPointScript's geometric
      // fallback (see translate.js) has to find the real paragraph text
      // once elementFromPoint and its nearby-offset ring both come back
      // empty.
      const active = (await page.evaluate(() => window.api.getState())).settings.activeAccountId;
      await page.evaluate(
        ({ id, port }) => window.api.navigateAccount(id, `http://localhost:${port}/`),
        { id: active, port: OVERLAY_PORT }
      );
      await expect.poll(async () => {
        const s = await page.evaluate(() => window.api.getState());
        return s.accounts.find((a) => a.id === active)?.url;
      }).toContain(`localhost:${OVERLAY_PORT}`);

      // A point well inside #target's box (top:40,left:40,width:300) —
      // #overlay covers the whole viewport, so this point is ALSO covered
      // by #overlay and would resolve to it via a naive elementFromPoint.
      const result = await page.evaluate((id) => window.api.translateSelectionAt(id, 150, 55), active);
      expect(result.ok).toBe(true);
      expect(result.translated).toBe(1);

      const restored = await page.evaluate((id) => window.api.restoreTranslatedSelections(id), active);
      expect(restored.ok).toBe(true);
    });
  });
});
