const { contextBridge, ipcRenderer } = require('electron');

// Minimal preload for a popped-out account window (src/popout.html) — just
// relays the two messages that window's inline script needs: the initial
// account/partition/url info, and main's go-ahead once it has finished
// wiring the <webview>'s webContents (same 'webview:ready' choreography the
// main window uses, see wireAccountWebContents in main.js).
contextBridge.exposeInMainWorld('popoutAPI', {
  onInit: (cb) => ipcRenderer.on('popout:init', (_e, info) => cb(info)),
  onReady: (cb) => ipcRenderer.on('webview:ready', (_e, accountId) => cb(accountId))
});
