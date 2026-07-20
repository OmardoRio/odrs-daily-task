const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getTasks: () => ipcRenderer.invoke('tasks:get'),
  addTask: (text) => ipcRenderer.invoke('tasks:add', text),
  toggleTask: (id) => ipcRenderer.invoke('tasks:toggle', id),
  deleteTask: (id) => ipcRenderer.invoke('tasks:delete', id),
  renameTask: (id, text) => ipcRenderer.invoke('tasks:rename', id, text),
  reorderTasks: (orderedIds) => ipcRenderer.invoke('tasks:reorder', orderedIds),
  setDraft: (text) => ipcRenderer.invoke('draft:set', text),
  minimize: () => ipcRenderer.send('window:minimize'),
  close: () => ipcRenderer.send('window:close'),
  showContextMenu: () => ipcRenderer.send('context-menu:show'),
  showTaskContextMenu: (id, isRecurring) => ipcRenderer.send('task-context-menu:show', id, isRecurring),
  getGoogleStatus: () => ipcRenderer.invoke('google:getStatus'),
  connectGoogle: () => ipcRenderer.invoke('google:connect'),
  disconnectGoogle: () => ipcRenderer.invoke('google:disconnect'),
  onTasksUpdated: (callback) => {
    ipcRenderer.on('tasks:updated', (_event, state) => callback(state));
  },
  onGoogleStatusChanged: (callback) => {
    ipcRenderer.on('google:status-changed', (_event, status) => callback(status));
  },
});
