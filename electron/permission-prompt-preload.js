const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  respond: (decision, remember) => ipcRenderer.send('permission-prompt:respond', { decision, remember })
});
