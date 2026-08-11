const { test, expect } = require('./fixtures');

// autoUpdater never actually runs in dev (see the app.isPackaged guard in
// main.js), so there's no real 'update-downloaded' event to wait for here —
// this simulates it exactly the way main.js's own listener does: send
// 'update:downloaded' straight to the window. electronApp.evaluate() runs
// inside the real main process, so BrowserWindow.getAllWindows()[0] is the
// actual window this test's `page` is already looking at.
test.describe('update changelog modal', () => {
  test('shows the version and release notes, and "later" dismisses it', async ({ page, electronApp }) => {
    await electronApp.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].webContents.send('update:downloaded', {
        version: '9.9.9',
        releaseNotes: 'Nota de prueba para el changelog.'
      });
    });

    await expect(page.locator('#update-modal')).not.toHaveClass(/hidden/);
    await expect(page.locator('#update-version')).toContainText('9.9.9');
    await expect(page.locator('#update-notes')).toContainText('Nota de prueba');

    await page.locator('#update-later').click();
    await expect(page.locator('#update-modal')).toHaveClass(/hidden/);
  });

  test('falls back to a friendly message when there are no release notes', async ({ page, electronApp }) => {
    await electronApp.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].webContents.send('update:downloaded', {
        version: '9.9.10',
        releaseNotes: ''
      });
    });

    await expect(page.locator('#update-notes')).not.toHaveText('');
    await page.locator('#update-later').click();
  });
});
