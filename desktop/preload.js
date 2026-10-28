const { contextBridge, ipcRenderer } = require('electron');

/**
 * Shazam AI Desktop Preload Script
 * Bridges native macOS/desktop system APIs into the Shazam UI securely.
 */
contextBridge.exposeInMainWorld('shazamDesktop', {
  isDesktop: true,
  platform: process.platform,

  // Retrieve daemon configuration automatically without user copy-pasting
  getDaemonConfig: () => ipcRenderer.invoke('get-daemon-config'),

  // Native folder selection dialog
  selectFolder: () => ipcRenderer.invoke('select-folder'),

  // Execute terminal command via native Electron IPC
  execCommand: (command) => ipcRenderer.invoke('exec-command', command),

  // Native window controls
  minimize: () => ipcRenderer.send('window-minimize'),
  maximize: () => ipcRenderer.send('window-maximize'),
  close: () => ipcRenderer.send('window-close'),
});
