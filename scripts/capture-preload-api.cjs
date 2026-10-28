'use strict';
// Dev-time capture of a contextBridge preload surface into a schema-3 adapted
// API manifest. This never executes the preload in the app runtime: it runs it
// once under a fake `electron` with a Node vm, records the IPC calls/events,
// and writes a manifest for `emoon init --api`. It is intentionally a leaf
// developer tool; the runtime remains responsible for policy and dispatch.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { builtinModules } = require('node:module');

function has(object, key) { return Object.prototype.hasOwnProperty.call(object, key); }

function fail(message) {
  const error = new Error(message);
  error.code = 'ELECTRON_MBT_PRELOAD_CAPTURE';
  throw error;
}

function usage() {
  return [
    'usage: node scripts/capture-preload-api.cjs <preload.js> [--name api] [--out <manifest.json>]',
    '',
    'Evaluates the built preload with a fake electron.contextBridge/ipcRenderer,',
    'records each exposed function IPC channel and event topic, and writes a',
    'schema-3 adapted API manifest. Local preload requires are not executed.',
  ].join('\n');
}

function parseArgs(argv) {
  const options = { preload: null, name: null, out: null, help: false, operations: {} };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') { options.help = true; continue; }
    if (arg === '--operation') {
      const value = argv[index + 1];
      if (!value || value.startsWith('--') || !value.includes('=')) fail('--operation requires method=operation');
      const separator = value.indexOf('=');
      const method = value.slice(0, separator).trim();
      const operation = value.slice(separator + 1).trim();
      if (!method || !operation) fail('--operation requires method=operation');
      options.operations[method] = operation;
      index += 1;
      continue;
    }
    if (arg === '--name' || arg === '--out') {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) fail(`${arg} requires a value`);
      options[arg.slice(2)] = value;
      index += 1;
      continue;
    }
    if (arg.startsWith('--')) fail(`unknown option: ${arg}`);
    if (options.preload) fail(`unexpected argument: ${arg}`);
    options.preload = arg;
  }
  if (options.help) return options;
  if (!options.preload) fail('missing preload path');
  options.preload = path.resolve(options.preload);
  if (!fs.existsSync(options.preload) || !fs.statSync(options.preload).isFile()) fail(`preload is not a file: ${options.preload}`);
  if (!options.name) options.name = 'api';
  if (!options.out) options.out = `${options.preload}.api.json`;
  options.out = path.resolve(options.out);
  return options;
}

function capturePreload(preloadPath, expectedName, operations) {
  const source = fs.readFileSync(preloadPath, 'utf8');
  let exposedName = null;
  let exposedApi = null;
  let current = null;
  function record(kind, channel) {
    if (current && !current.channel) {
      current.kind = kind;
      current.channel = typeof channel === 'string' ? channel : '';
    }
  }
  const ipcRenderer = {
    invoke(channel) { record('invoke', channel); return Promise.resolve(null); },
    send(channel) { record('send', channel); },
    sendSync(channel) { record('sendSync', channel); return null; },
    postMessage(channel) { record('postMessage', channel); },
    on(channel) { record('on', channel); return ipcRenderer; },
    once(channel) { record('on', channel); return ipcRenderer; },
    off() { return ipcRenderer; },
    removeListener() { return ipcRenderer; },
    removeAllListeners() { return ipcRenderer; },
    emit() {},
  };
  const contextBridge = {
    exposeInMainWorld(name, api) {
      if (exposedApi !== null) fail('preload exposes more than one main-world API');
      exposedName = String(name);
      exposedApi = api;
    },
  };
  const fakeElectron = {
    contextBridge: contextBridge,
    ipcRenderer: ipcRenderer,
    webUtils: { getPathForFile() { return ''; } },
    nativeImage: { createFromPath() { return {}; } },
    app: {
      getPath() { return '/tmp'; },
      getVersion() { return '0.0.0'; },
      getName() { return 'preload-capture'; },
      on() {},
      whenReady() { return Promise.resolve(); },
    },
    dialog: {},
    shell: { openExternal() {} },
  };
  const realRequire = require;
  function sandboxRequire(id) {
    if (id === 'electron') return fakeElectron;
    if (id.startsWith('node:') || builtinModules.includes(id)) return realRequire(id);
    throw new Error(`preload-capture does not execute local require: ${id}`);
  }
  class FakePort {
    constructor() { this.onmessage = null; this.onmessageerror = null; }
    start() {}
    close() {}
    postMessage() {}
  }
  class FakeMessageChannel {
    constructor() { this.port1 = new FakePort(); this.port2 = new FakePort(); }
  }
  const sandbox = {
    require: sandboxRequire,
    module: { exports: {} },
    exports: {},
    __filename: preloadPath,
    __dirname: path.dirname(preloadPath),
    process: process,
    Buffer: Buffer,
    URL: URL,
    TextDecoder: TextDecoder,
    TextEncoder: TextEncoder,
    Uint8Array: Uint8Array,
    ArrayBuffer: ArrayBuffer,
    DataView: DataView,
    MessageChannel: FakeMessageChannel,
    setTimeout: function () { return 0; },
    clearTimeout: function () {},
    setImmediate: function (callback) { if (typeof callback === 'function') callback(); return 0; },
    clearImmediate: function () {},
    queueMicrotask: function (callback) { if (typeof callback === 'function') callback(); },
    console: {
      log: function () { console.error.apply(console, arguments); },
      warn: function () { console.error.apply(console, arguments); },
      error: function () { console.error.apply(console, arguments); },
      info: function () { console.error.apply(console, arguments); },
      debug: function () { console.error.apply(console, arguments); },
    },
  };
  sandbox.global = sandbox;
  sandbox.globalThis = sandbox;
  try {
    vm.runInNewContext(source, sandbox, { filename: preloadPath, timeout: 5000 });
  } catch (error) {
    fail(`preload evaluation failed: ${error.message}`);
  }
  if (exposedApi === null || (typeof exposedApi !== 'object' && typeof exposedApi !== 'function')) {
    fail('preload did not call contextBridge.exposeInMainWorld with an object');
  }
  const topics = [];
  const calls = [];
  const unsupported = [];
  const names = Object.getOwnPropertyNames(exposedApi);
  for (const name of names) {
    if (name === 'constructor') continue;
    let value;
    try { value = exposedApi[name]; } catch { continue; }
    if (typeof value !== 'function') continue;
    const state = { kind: null, channel: null };
    current = state;
    let thrown = null;
    try {
      const argumentsList = new Array(Math.min(value.length, 8)).fill(undefined);
      value.apply(exposedApi, argumentsList);
    } catch (error) {
      thrown = error;
    }
    current = null;
    if (state.kind === 'on' && state.channel) {
      topics.push({ topic: state.channel, method: name });
    } else if (state.channel) {
      const operation = has(operations, name) ? operations[name] : state.channel;
      if (value.length === 0) {
        calls.push({ name: name, operation: operation, args: 'none' });
      } else if (value.length <= 4) {
        calls.push({ name: name, operation: operation, args: 'json-list', arity: value.length });
      } else {
        unsupported.push({
          name: name,
          code: 'ELECTRON_MBT_UNSUPPORTED_API',
          reason: `arity ${value.length} exceeds the adapted API limit of 4`,
        });
      }
    } else {
      unsupported.push({
        name: name,
        code: 'ELECTRON_MBT_UNSUPPORTED_API',
        reason: thrown ? `no IPC operation observed: ${String(thrown.message || thrown)}` : 'no IPC operation observed',
      });
    }
  }
  return {
    name: exposedName || expectedName,
    topics: topics,
    calls: calls,
    unsupported: unsupported,
  };
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return 0;
  }
  const captured = capturePreload(options.preload, options.name, options.operations);
  const manifest = {
    schema: 3,
    name: captured.name,
    version: 'preload-capture-v1',
    topics: captured.topics,
    calls: captured.calls,
    unsupported: captured.unsupported,
    filePolicy: {
      open: 'open-for-edit',
      rights: ['read', 'replace-selected'],
      write: 'atomic-replace-v1',
      restart: 'reauthorize',
    },
    queue: { maxCalls: 8, maxBytes: 65536, readyTimeoutMs: 2000 },
  };
  fs.mkdirSync(path.dirname(options.out), { recursive: true });
  fs.writeFileSync(options.out, `${JSON.stringify(manifest, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({
    ok: true,
    name: manifest.name,
    calls: manifest.calls.length,
    topics: manifest.topics.length,
    unsupported: manifest.unsupported.length,
    output: options.out,
  })}\n`);
  if (manifest.calls.length === 0) {
    process.stderr.write('preload-capture: warning: no IPC calls were observed\n');
  }
  return 0;
}

try {
  process.exitCode = main();
} catch (error) {
  process.stdout.write(`${JSON.stringify({
    ok: false,
    compatible: false,
    code: error.code || 'ELECTRON_MBT_PRELOAD_CAPTURE',
    message: error.message,
  })}\n`);
  process.exitCode = 1;
}
