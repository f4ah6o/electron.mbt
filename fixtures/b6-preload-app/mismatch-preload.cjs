'use strict';
const { contextBridge } = require('electron');
const key = typeof process === 'undefined' ? 'actual-key' : 'preview-key';
contextBridge.exposeInMainWorld(key, { value: key });
