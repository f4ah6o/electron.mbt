'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('demo', {
  getValue: () => ipcRenderer.invoke('demo:get'),
  setValue: (value) => ipcRenderer.invoke('demo:set', value),
  ping: () => ipcRenderer.send('demo:ping'),
  onEvent: (callback) => {
    const listener = (_event, value) => callback(value);
    ipcRenderer.on('demo:event', listener);
    return () => ipcRenderer.removeListener('demo:event', listener);
  },
  stream: (filePath) => {
    const { port1, port2 } = new MessageChannel();
    port1.onmessage = () => {};
    ipcRenderer.postMessage('demo:stream', filePath, [port2]);
    return new Promise(() => {});
  },
  localOnly: () => 'local',
});
