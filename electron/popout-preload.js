const { contextBridge, ipcRenderer } = require('electron');

// Minimal preload for a popped-out account window (src/popout.html) — just
// relays the two messages that window's inline script needs: the initial
// account/partition/url info, and main's go-ahead once it has finished
// wiring the <webview>'s webContents (same 'webview:ready' choreography the
// main window uses, see wireAccountWebContents in main.js).
//
// Both return an unsubscribe function, matching preload.js's onIpc(). That
// file's own comment names "screenshot editor, popout" as the windows where
// piling up duplicate listeners would actually matter, because they have
// short lifetimes and can be opened repeatedly — but the fix had only been
// applied to the one long-lived window that didn't need it.
function onIpc(channel, cb) {
  const listener = (_e, ...args) => cb(...args);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('popoutAPI', {
  onInit: (cb) => onIpc('popout:init', cb),
  onReady: (cb) => onIpc('webview:ready', cb)
});
