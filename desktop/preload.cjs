const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('ridian', {
  request: (method, path, body) => ipcRenderer.invoke('data:request', method, path, body),
  expand: value => ipcRenderer.invoke('window:expand', value),
  hover: value => ipcRenderer.send('window:hover', value),
  drag: (phase, x, y) => ipcRenderer.send('window:drag', phase, x, y),
  menu: () => ipcRenderer.send('window:menu'),
  taskMenu: id => ipcRenderer.send('task:menu', id),
  history: () => ipcRenderer.send('window:history'),
  onExpanded: callback => { const listener = (_, value) => callback(value); ipcRenderer.on('window:expanded', listener); return () => ipcRenderer.removeListener('window:expanded', listener); }
});
