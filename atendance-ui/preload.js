const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  startWaitingForCard: () => ipcRenderer.send('start-waiting-for-card'),
  stopWaitingForCard: () => ipcRenderer.send('stop-waiting-for-card'),
  startConnection: () => ipcRenderer.send('start-connection'),
  stopConnection: () => ipcRenderer.send('stop-connection'),
  onCardData: (callback) => ipcRenderer.on('card-data', callback),
  fetchLogs: () => ipcRenderer.invoke('fetch-logs'),
  fetchActiveUsers: () => ipcRenderer.invoke('fetch-active-users'),
  fetchActiveAllUsers: () => ipcRenderer.invoke('fetch-active-all-users'),
  saveUser: () => ipcRenderer.send('save-user'),
  onConnectionStatus: (callback) => ipcRenderer.on('connection-status', callback),
  onIsMainTab: (callback) => ipcRenderer.on('is-main-tab', callback),
  setAuthMode: () => ipcRenderer.send('auth-mode'),
  onAuthResult: (callback) => ipcRenderer.on('auth-result', callback),
  onSaveResult: (callback) => ipcRenderer.on('save-result', callback),
});