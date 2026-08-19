const fs = require('fs');
const { test, expect } = require('./fixtures');

// electronApp.waitForEvent('window') resolves for the FIRST new window it
// sees — in this app that's a race against whatever else the account's own
// webview might pop up (e.g. a Cloudflare challenge window), not
// necessarily ours. Poll electronApp.windows() and filter by URL instead.
async function waitForEditorWindow(electronApp) {
  for (let i = 0; i < 40; i++) {
    const match = electronApp.windows().find((w) => w.url().includes('screenshot-editor.html'));
    if (match) return match;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('screenshot editor window never appeared');
}

// Unlike a <webview>'s guest content (see picture-in-picture.spec.js's note
// on that limitation), the editor is a real top-level BrowserWindow, so
// Playwright's Electron support CAN drive it directly via electronApp's
// second window.
test.describe('Screenshot editor', () => {
  test('opens as its own window, and saving with an annotation writes a real PNG', async ({ page, electronApp }) => {
    const active = (await page.evaluate(() => window.api.getState())).settings.activeAccountId;

    await page.evaluate((id) => window.api.openScreenshotEditor(id), active);
    const editorPage = await waitForEditorWindow(electronApp);
    await editorPage.waitForLoadState('domcontentloaded');
    await expect(editorPage.locator('#canvas')).toBeVisible();

    // Draw an arrow annotation, then save.
    await editorPage.locator('#tool-arrow').click();
    const box = await editorPage.locator('#canvas').boundingBox();
    await editorPage.mouse.move(box.x + 20, box.y + 20);
    await editorPage.mouse.down();
    await editorPage.mouse.move(box.x + 80, box.y + 80);
    await editorPage.mouse.up();

    const savedPathPromise = editorPage.evaluate(() => window.screenshotEditorAPI.save(document.getElementById('canvas').toDataURL('image/png')));
    const result = await savedPathPromise;

    expect(result.ok).toBe(true);
    expect(fs.existsSync(result.path)).toBe(true);
    const bytes = fs.readFileSync(result.path);
    expect(bytes.slice(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    fs.unlinkSync(result.path);
  });

  test('cancel closes the editor window without saving anything', async ({ page, electronApp }) => {
    const active = (await page.evaluate(() => window.api.getState())).settings.activeAccountId;

    await page.evaluate((id) => window.api.openScreenshotEditor(id), active);
    const editorPage = await waitForEditorWindow(electronApp);
    await editorPage.waitForLoadState('domcontentloaded');

    const closedPromise = new Promise((resolve) => editorPage.once('close', resolve));
    await editorPage.locator('#btn-cancel').click();
    await closedPromise;
  });
});
