// @ts-check
const { contextBridge, ipcRenderer } = require('electron');

// Minimal preload for the screenshot editor window (src/screenshot-editor.html)
// — mirrors popout-preload.js's pattern: just the handful of messages that
// window's own script needs, nothing shared with the main app's IPC surface.
// onImage returns an unsubscribe function for the same reason it does there:
// this window is opened and closed repeatedly, which is exactly the case
// preload.js's onIpc() comment was written about.
function onIpc(channel, cb) {
  const listener = (_e, ...args) => cb(...args);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('screenshotEditorAPI', {
  onImage: (cb) => onIpc('screenshot-editor:image', cb),
  save: (dataUrl) => ipcRenderer.invoke('screenshot-editor:save', dataUrl),
  cancel: () => ipcRenderer.invoke('screenshot-editor:cancel')
});
