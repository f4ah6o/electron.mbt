'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { TextEncoder, TextDecoder } = require('node:util');
const { runtimeError } = require('./errors.cjs');

const codecSource = fs.readFileSync(path.join(__dirname, '..', 'preload', 'codec.js'), 'utf8');

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
  let exposedApi = null;
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
      exposedApi = api;
      sandbox.__m0CbApi = api;
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
    TextEncoder,
    TextDecoder,
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
    sandbox.__m0CbApi = exposedApi;
    // The API is a VM object; encode it with the same codec source inside the
    // VM realm so the descriptor is the one the real isolated bridge produces.
    // Hide the CommonJS module binding so the UMD codec installs on globalThis
    // exactly as it does in the browser content worlds.
    sandbox.module = undefined;
    sandbox.exports = undefined;
    vm.runInContext(codecSource, context, { filename: 'codec.js', timeout: 2000, displayErrors: false });
    sandbox.__m0CbSecret = '0'.repeat(32);
    sandbox.__m0CbDescriptor = vm.runInContext(`(function () {
      const factory = globalThis.__m0CbCodec;
      const codec = factory.createCodec({
        secret: globalThis.__m0CbSecret,
        limits: { maxBytes: 65536, maxDepth: 8, maxNodes: 512, maxString: 32768, maxHandles: 256 },
      });
      let count = 0;
      const descriptor = codec.encode(globalThis.__m0CbApi, {
        allowFunctions: true,
        allowPromises: false,
        allowUndefined: false,
        onFunction: function () { count += 1; return 'ef-' + count; },
      });
      return { descriptor, functionCount: count };
    })()`, context, { filename: 'descriptor.js', timeout: 2000, displayErrors: false });
  } catch (error) {
    if (error && error.code === 'ELECTRON_MBT_PRELOAD_KEY_DISCOVERY') throw error;
    throw runtimeError('ELECTRON_MBT_PRELOAD_KEY_DISCOVERY', 'Preload key preview failed');
  }
  if (keys.length !== 1 || !sandbox.__m0CbDescriptor) {
    throw runtimeError('ELECTRON_MBT_PRELOAD_KEY_DISCOVERY',
      'Preload did not expose exactly one API key');
  }
  const descriptor = sandbox.__m0CbDescriptor.descriptor;
  const functionCount = sandbox.__m0CbDescriptor.functionCount;
  if (typeof descriptor !== 'string' || !Number.isSafeInteger(functionCount) || functionCount < 0) {
    throw runtimeError('ELECTRON_MBT_PRELOAD_KEY_DISCOVERY', 'Invalid preview descriptor');
  }
  return Object.freeze({
    apiKey: keys[0],
    descriptorBytes: Buffer.byteLength(descriptor, 'utf8'),
    functionCount,
    descriptorSha256: crypto.createHash('sha256').update(descriptor).digest('hex'),
    descriptor,
  });
}

module.exports = { discoverPreloadApiKey, validApiKey };
