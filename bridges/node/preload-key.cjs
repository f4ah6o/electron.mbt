'use strict';
const vm = require('node:vm');
const { runtimeError } = require('./errors.cjs');

const RESERVED = new Set([
  'window', 'document', 'globalThis', 'process', 'require', 'module',
  'exports', 'electron', '__proto__', 'prototype', 'constructor',
]);

function validApiKey(key) {
  if (typeof key !== 'string' || key.length === 0 || key.length > 64 ||
      RESERVED.has(key)) return false;
  for (let index = 0; index < key.length; index++) {
    const code = key.charCodeAt(index);
    if (code === 0 || code < 32 || code === 127) return false;
  }
  return true;
}

// Discover the single contextBridge key by evaluating the unchanged preload in
// a disposable, side-effect-free VM context. This is a preview only: the real
// preload still runs in WKWebView and the signed descriptor must match the
// discovered key. It does not replace preload validation or the B6 transport.
function discoverPreloadApiKey(preloadSource, filename = 'preload.cjs') {
  if (typeof preloadSource !== 'string' || preloadSource.length === 0 ||
      preloadSource.length > 65536 || !preloadSource.isWellFormed()) {
    throw runtimeError('ELECTRON_MBT_PRELOAD_KEY_DISCOVERY', 'Invalid preload source');
  }
  const keys = [];
  const unsupported = name => {
    const error = new Error(`ELECTRON_MBT_UNSUPPORTED_PRELOAD_MODULE: ${name}`);
    error.code = 'ELECTRON_MBT_UNSUPPORTED_PRELOAD_MODULE';
    throw error;
  };
  const contextBridge = {
    exposeInMainWorld(apiKey, api) {
      if (!validApiKey(apiKey)) {
        throw runtimeError('ELECTRON_MBT_PRELOAD_KEY_DISCOVERY', 'Invalid exposed API key');
      }
      if (!api || typeof api !== 'object' || Array.isArray(api)) {
        throw runtimeError('ELECTRON_MBT_PRELOAD_KEY_DISCOVERY', 'Invalid exposed API object');
      }
      if (keys.length >= 1) {
        throw runtimeError('ELECTRON_MBT_PRELOAD_KEY_DISCOVERY',
          'The experimental transport supports one exposed API key');
      }
      keys.push(apiKey);
    },
  };
  const ipcRenderer = {
    send() { unsupported('ipcRenderer.send'); },
    invoke() { return Promise.reject(runtimeError('ELECTRON_MBT_UNSUPPORTED_PRELOAD_MODULE', 'ipcRenderer.invoke')); },
    on() { unsupported('ipcRenderer.on'); },
    once() { unsupported('ipcRenderer.once'); },
    removeListener() { unsupported('ipcRenderer.removeListener'); },
    removeAllListeners() { unsupported('ipcRenderer.removeAllListeners'); },
  };
  const electron = {
    contextBridge,
    ipcRenderer,
    webUtils: { getPathForFile() { unsupported('webUtils.getPathForFile'); } },
  };
  const requireFn = name => {
    if (name === 'electron') return electron;
    return unsupported(name);
  };
  const module = { exports: {} };
  const sandbox = {
    module,
    exports: module.exports,
    require: requireFn,
    console: { log() {}, warn() {}, error() {} },
    process: { platform: 'darwin', env: {}, versions: {} },
    setTimeout() { return 0; },
    clearTimeout() {},
    setInterval() { return 0; },
    clearInterval() {},
    queueMicrotask() {},
  };
  sandbox.globalThis = sandbox;
  sandbox.window = sandbox;
  const context = vm.createContext(sandbox, {
    name: 'electron-mbt-preload-key-preview',
    codeGeneration: { strings: false, wasm: false },
  });
  try {
    vm.runInContext(
      `(function (module, exports, require) {\n${preloadSource}\n})(module, exports, require);`,
      context,
      { filename, timeout: 2000, displayErrors: false },
    );
  } catch (error) {
    if (error && error.code === 'ELECTRON_MBT_PRELOAD_KEY_DISCOVERY') throw error;
    throw runtimeError('ELECTRON_MBT_PRELOAD_KEY_DISCOVERY', 'Preload key preview failed');
  }
  if (keys.length !== 1) {
    throw runtimeError('ELECTRON_MBT_PRELOAD_KEY_DISCOVERY',
      'Preload did not expose exactly one API key');
  }
  return keys[0];
}

module.exports = { discoverPreloadApiKey, validApiKey };
