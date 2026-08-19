const { contextBridge, ipcRenderer } = require('electron');

// Minimal preload for the screenshot editor window (src/screenshot-editor.html)
// — mirrors popout-preload.js's pattern: just the handful of messages that
// window's own script needs, nothing shared with the main app's IPC surface.
contextBridge.exposeInMainWorld('screenshotEditorAPI', {
  onImage: (cb) => ipcRenderer.on('screenshot-editor:image', (_e, payload) => cb(payload)),
  save: (dataUrl) => ipcRenderer.invoke('screenshot-editor:save', dataUrl),
  cancel: () => ipcRenderer.invoke('screenshot-editor:cancel')
});
