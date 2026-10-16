'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('invokeHandlerFixture', (channel, args) => {
  if (channel !== 'electron-mbt:invoke-contract') throw new Error('Unknown fixture channel');
  return ipcRenderer.invoke(channel, ...args);
});
