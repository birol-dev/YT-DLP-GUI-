const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  downloadVideo: (data) => ipcRenderer.send('download-video', data),
  downloadAudio: (data) => ipcRenderer.send('download-audio', data),
  downloadInstagram: (data) => ipcRenderer.send('download-instagram', data),
  continueAnyway: () => ipcRenderer.send('continue-anyway'),
  downloadSubtitles: (data) => ipcRenderer.send('download-subtitles', data),
  openFolder: (filePath) => ipcRenderer.send('open-folder', filePath),
  openDownloadFolder: (type) => ipcRenderer.send('open-download-folder', type),
  onDownloadStatus: (callback) => ipcRenderer.on('download-status', (_event, value) => callback(value)),
  onDownloadProgress: (callback) => ipcRenderer.on('download-progress', (_event, value) => callback(value)),
  onDownloadComplete: (callback) => ipcRenderer.on('download-complete', (_event, value) => callback(value)),
  onDownloadError: (callback) => ipcRenderer.on('download-error', (_event, value) => callback(value)),
  onUpdateLog: (callback) => ipcRenderer.on('update-log', (_event, value) => callback(value)),
  onDependencyStatus: (callback) => ipcRenderer.on('dependency-status', (_event, value) => callback(value)),
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),
  selectFolder: () => ipcRenderer.invoke('select-folder'),
  fetchVideoInfo: (url) => ipcRenderer.invoke('fetch-video-info', url),
  downloadClip: (data) => ipcRenderer.send('download-clip', data),
});
