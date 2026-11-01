const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('bridge', {
  getState: () => ipcRenderer.invoke('bridge-get-state'),
  connect: () => ipcRenderer.invoke('bridge-connect'),
  cancelConnect: () => ipcRenderer.invoke('bridge-cancel-connect'),
  setOpenAtLogin: (on) => ipcRenderer.invoke('bridge-set-open-at-login', on),
  pair: (code, server, name) => ipcRenderer.invoke('bridge-pair', { code, server, name }),
  addFolder: () => ipcRenderer.invoke('bridge-add-folder'),
  removeFolder: (folder) => ipcRenderer.invoke('bridge-remove-folder', folder),
  unpair: () => ipcRenderer.invoke('bridge-unpair'),
  openPairingPage: () => ipcRenderer.invoke('bridge-open-pairing-page'),
  onState: (cb) => ipcRenderer.on('bridge-state', (_e, s) => cb(s)),
});
