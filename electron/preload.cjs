const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  quit: () => ipcRenderer.invoke('app/quit'),
  getYoutubeInfo: (url) => ipcRenderer.invoke('youtube/get-info', url),
  startDownload: (url, options) => ipcRenderer.invoke('download/start', url, options),
  pauseDownload: (id) => ipcRenderer.invoke('download/pause', id),
  resumeDownload: (id) => ipcRenderer.invoke('download/resume', id),
  cancelDownload: (id) => ipcRenderer.invoke('download/cancel', id),
  deleteDownload: (id) => ipcRenderer.invoke('download/delete', id),
  listDownloads: () => ipcRenderer.invoke('download/list'),
  openFile: (path) => ipcRenderer.invoke('open/file', path),
  openFolder: (path) => ipcRenderer.invoke('open/folder', path),
  onDownloadDetected: (cb) => {
    ipcRenderer.on('download-detected', (_e, url) => cb(url));
    return () => ipcRenderer.removeAllListeners('download-detected');
  },
  onDownloadEvent: (event, cb) => {
    const channel = `download/${event}`;
    ipcRenderer.on(channel, (_e, data) => cb(data));
    return () => ipcRenderer.removeAllListeners(channel);
  }
});
