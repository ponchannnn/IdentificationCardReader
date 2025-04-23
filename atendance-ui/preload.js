const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  startConnection: () => ipcRenderer.send('start-connection'),
  stopConnection: () => ipcRenderer.send('stop-connection'),
  fetchLogs: () => ipcRenderer.invoke('fetch-logs'),
  fetchActiveAllUsers: () => ipcRenderer.invoke('fetch-active-all-users-with-status'),
  saveUser: () => ipcRenderer.send('save-user'),
  onConnectionStatus: (callback) => ipcRenderer.on('connection-status', callback),
  onIsMainTab: (isMainTab) => ipcRenderer.send('is-main-tab', isMainTab),
  setAuthMode: () => ipcRenderer.send('auth-mode'),
  onMainResult: (callback) => ipcRenderer.on('main-result', callback),
  onAuthResult: (callback) => ipcRenderer.on('auth-result', callback),
  onSaveResult: (callback) => ipcRenderer.on('save-result', callback),
  onDeleteResult: (callback) => ipcRenderer.on('delete-result', callback),
  onShowModal: (callback) => ipcRenderer.on('show-modal', callback),
  cancelMode: () => ipcRenderer.send('cancel-mode'),
});