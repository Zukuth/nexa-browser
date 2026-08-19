const { BrowserWindow } = require('electron');

// Shared by permissions-manager.js (the permission-prompt popup) and
// extensions-manager.js (the extension-toolbar popup) — both needed a small,
// frameless, always-on-top, non-resizable window positioned relative to the
// main window's current bounds, and had independently written the exact
// same construction+positioning block. One shared helper means a future
// change to how these are positioned (multi-monitor clamping, DPI scaling)
// only has to be made once instead of drifting between two copies.
function createAnchoredPopup(getMainWindow, { width, height, anchor = 'top-center', offsetY = 90, windowOptions = {} }) {
  const popup = new BrowserWindow({
    width,
    height,
    resizable: false,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    ...windowOptions
  });
  const mainWindow = getMainWindow();
  if (mainWindow && !mainWindow.isDestroyed()) {
    const b = mainWindow.getBounds();
    const x = anchor === 'top-right'
      ? Math.round(b.x + b.width - width - 20)
      : Math.round(b.x + (b.width - width) / 2);
    popup.setPosition(x, Math.round(b.y + offsetY));
  }
  return popup;
}

module.exports = { createAnchoredPopup };
