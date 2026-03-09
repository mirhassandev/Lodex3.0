const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  quit: () => ipcRenderer.invoke('app/quit'),
  getYoutubeInfo: (url) => ipcRenderer.invoke('youtube/get-info', url),
  getStreamInfo: (url, headers) => ipcRenderer.invoke('stream/get-info', url, headers || {}),
  classifyUrl: (url, headers) => ipcRenderer.invoke('url/classify', url, headers || {}),
  analyzeMedia: (url, classification, headers) => ipcRenderer.invoke('media/analyze', url, classification || null, headers || {}),
  startDownload: (url, options) => ipcRenderer.invoke('download/start', url, options),
  pauseDownload: (id) => ipcRenderer.invoke('download/pause', id),
  resumeDownload: (id) => ipcRenderer.invoke('download/resume', id),
  cancelDownload: (id) => ipcRenderer.invoke('download/cancel', id),
  deleteDownload: (id) => ipcRenderer.invoke('download/delete', id),
  moveUpDownload: (id) => ipcRenderer.invoke('download/move-up', id),
  moveDownDownload: (id) => ipcRenderer.invoke('download/move-down', id),
  updatePriority: (id, priority) => ipcRenderer.invoke('download/update-priority', id, priority),
  listDownloads: () => ipcRenderer.invoke('download/list'),
  openFile: (path) => ipcRenderer.invoke('open/file', path),
  openFolder: (path) => ipcRenderer.invoke('open/folder', path),
  selectFolder: () => ipcRenderer.invoke('dialog/select-folder'),
  closeDialog: () => ipcRenderer.send('dialog/close'),
  minimize: () => ipcRenderer.send('window/minimize'),
  close: () => ipcRenderer.send('window/close'),
  refreshSettings: () => ipcRenderer.invoke('settings/refresh'),
  onDownloadDetected: (cb) => {
    ipcRenderer.on('download-detected', (_e, source, url, headers, meta) => cb(source, url, headers, meta));
    return () => ipcRenderer.removeAllListeners('download-detected');
  },
  onDownloadEvent: (event, cb) => {
    const channel = `download/${event}`;
    ipcRenderer.on(channel, (_e, data) => cb(data));
    return () => ipcRenderer.removeAllListeners(channel);
  }
});
