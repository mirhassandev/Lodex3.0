const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  quit: () => ipcRenderer.invoke('app/quit'),
  minimize: () => ipcRenderer.send('window/minimize'),
  maximize: () => ipcRenderer.send('window/maximize'),
  close: () => ipcRenderer.send('window/close'),
  
  // Download APIs
  getDownloads: () => ipcRenderer.invoke('download/list'),
  triggerDownload: (url) => ipcRenderer.invoke('trigger-download', url),
  cancelDownload: (id) => ipcRenderer.invoke('download/cancel', id),
  deleteDownload: (id, deleteFile) => ipcRenderer.invoke('download/delete', id, deleteFile),
  setConcurrency: (limit) => ipcRenderer.invoke('download/set-concurrency', limit),
  moveUp: (id) => ipcRenderer.invoke('download/move-up', id),
  moveDown: (id) => ipcRenderer.invoke('download/move-down', id),
  openFolder: (path) => ipcRenderer.invoke('open/folder', path),
  openFile: (path) => ipcRenderer.invoke('open/file', path),
  getDiskInfo: (path) => ipcRenderer.invoke('system/get-disk-info', path),
});
