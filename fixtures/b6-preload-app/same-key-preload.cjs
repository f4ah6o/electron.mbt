'use strict';
// Same exposed key in both environments; only the descriptor differs.
// The VM preview provides a `process` object, while the real WebKit preload
// wrapper does not. The page must not materialize the two-function actual API:
// MoonBit admitted the one-function preview descriptor.
const { contextBridge } = require('electron');
const preview = typeof process === 'object' && process !== null;
const api = { ping: () => 1 };
if (!preview) api.extra = () => 2;
contextBridge.exposeInMainWorld('fixture', api);
