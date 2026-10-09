'use strict';
const { contextBridge, ipcRenderer } = require('electron');
const callbacks = new Set();
const originalMap = Array.prototype.map;
contextBridge.exposeInMainWorld('fixture', {
  data: { nested: { value: 7 } },
  syncValue: () => 42,
  syncThrow: () => { throw new Error('fixture-sync-error'); },
  promiseValue: () => Promise.resolve(43),
  promiseReject: () => Promise.reject(new Error('fixture-promise-error')),
  add: callback => { callbacks.add(callback); },
  remove: callback => { callbacks.delete(callback); },
  fire: value => { for (const callback of callbacks) callback(value); },
  primordialIntact: () => Array.prototype.map === originalMap,
  report: value => { ipcRenderer.send('fixture:report', value); },
});
