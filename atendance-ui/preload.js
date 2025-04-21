const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  startConnection: () => ipcRenderer.send('start-connection'),
  stopConnection: () => ipcRenderer.send('stop-connection'),
  onCardData: (callback) => ipcRenderer.on('card-data', callback),
  fetchLogs: () => ipcRenderer.invoke('fetch-logs'),
  fetchActiveUsers: () => ipcRenderer.invoke('fetch-active-users'),
  fetchActiveAllUsers: () => ipcRenderer.invoke('fetch-active-all-users'),
  saveUser: () => ipcRenderer.send('save-user'),
  onConnectionStatus: (callback) => ipcRenderer.on('connection-status', callback),
  onIsMainTab: (isMainTab) => ipcRenderer.send('is-main-tab', isMainTab),
  setAuthMode: () => ipcRenderer.send('auth-mode'),
  onMainResult: (callback) => ipcRenderer.on('main-result', callback),
  onAuthResult: (callback) => ipcRenderer.on('auth-result', callback),
  onSaveResult: (callback) => ipcRenderer.on('save-result', callback),
  onDeleteResult: (callback) => ipcRenderer.on('delete-result', callback),
});