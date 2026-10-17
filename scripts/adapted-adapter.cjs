'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function fail(message) { throw new Error(`ELECTRON_MBT_ADAPTED_ADAPTER: ${message}`); }
function validName(value) { return typeof value === 'string' && /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(value); }
function boundedString(value, length) {
  return typeof value === 'string' && value.length > 0 && value.length <= length;
}
function boundedInteger(value, max) {
  return Number.isInteger(value) && value > 0 && value <= max;
}

function validate(manifest) {
  if (!manifest || manifest.schema !== 2) fail('expected schema 2');
  if (!validName(manifest.name)) fail('invalid API name');
  if (!boundedString(manifest.version, 128)) fail('invalid API version');
  if (!Array.isArray(manifest.topics) || manifest.topics.length === 0 || manifest.topics.length > 16) {
    fail('topics must be a non-empty bounded array');
  }
  const topics = new Set();
  const topicMethods = new Set();
  for (const entry of manifest.topics) {
    if (!entry || !boundedString(entry.topic, 128) || !validName(entry.method)) fail('invalid topic');
    if (topics.has(entry.topic)) fail('duplicate topic');
    if (topicMethods.has(entry.method)) fail('duplicate topic method');
    topics.add(entry.topic);
    topicMethods.add(entry.method);
  }
  if (!Array.isArray(manifest.calls) || manifest.calls.length === 0 || manifest.calls.length > 32) {
    fail('calls must be a non-empty bounded array');
  }
  const callNames = new Set();
  const operations = new Set();
  for (const entry of manifest.calls) {
    if (!entry || !validName(entry.name)) fail('invalid call');
    if (!boundedString(entry.operation, 128)) fail('invalid call operation');
    if (entry.args !== 'none' && entry.args !== 'json') fail('invalid call args');
    if (callNames.has(entry.name)) fail('duplicate call');
    if (operations.has(entry.operation)) fail('duplicate operation');
    callNames.add(entry.name);
    operations.add(entry.operation);
  }
  const queue = manifest.queue;
  if (!queue || !boundedInteger(queue.maxCalls, 256) ||
      !boundedInteger(queue.maxBytes, 1048576) ||
      !boundedInteger(queue.readyTimeoutMs, 60000)) {
    fail('invalid queue limits');
  }
  for (const name of [...topicMethods, ...callNames]) {
    if (name === 'version') fail('reserved API name');
  }
  for (const name of callNames) {
    if (topicMethods.has(name)) fail('duplicate API member');
  }
  return manifest;
}

function buildAdapter(input) {
  const manifest = validate(input);
  const topicList = manifest.topics.map(entry => JSON.stringify(entry.topic)).join(', ');
  const members = [
    `    version: function () { return ${JSON.stringify(manifest.version)}; }`,
    ...manifest.topics.map(entry =>
      `    ${entry.method}: function (callback) { return addListener(${JSON.stringify(entry.topic)}, callback); }`),
    ...manifest.calls.map(entry => entry.args === 'json'
      ? `    ${entry.name}: function (value) { return invoke(${JSON.stringify(entry.operation)}, value, true); }`
      : `    ${entry.name}: function () { return invoke(${JSON.stringify(entry.operation)}, null, false); }`),
  ];
  const source = `'use strict';
(function () {
  const TOPICS = Object.freeze([${topicList}]);
  const MAX_CALLS = ${manifest.queue.maxCalls};
  const MAX_BYTES = ${manifest.queue.maxBytes};
  const READY_TIMEOUT_MS = ${manifest.queue.readyTimeoutMs};
  const listeners = new Map();
  const pending = [];
  let pendingBytes = 0;
  let ready = false;
  let terminated = false;
  let timer = null;
  let host = null;
  try {
    const candidate = window.__electronMbtIngress;
    if (candidate && typeof candidate === 'object') host = candidate;
  } catch (_) {}
  try { delete window.__electronMbtIngress; } catch (_) {}
  const adapterError = function (code, message) {
    const error = new Error(message);
    error.code = code;
    return error;
  };
  const utf8Bytes = function (text) {
    if (typeof TextEncoder === 'function') return new TextEncoder().encode(text).length;
    let bytes = 0;
    for (let index = 0; index < text.length; index += 1) {
      const code = text.charCodeAt(index);
      if (code < 0x80) bytes += 1;
      else if (code < 0x800) bytes += 2;
      else if (code >= 0xd800 && code <= 0xdbff) { bytes += 4; index += 1; }
      else bytes += 3;
    }
    return bytes;
  };
  const settle = function (record, ok, value) {
    if (record.settled) return;
    record.settled = true;
    if (ok) record.resolve(value);
    else record.reject(value);
  };
  const dispatch = function (record) {
    if (record.settled) return;
    if (!host || typeof host.dispatch !== 'function') {
      settle(record, false, adapterError('ELECTRON_MBT_ADAPTER_INGRESS_UNAVAILABLE', 'document ingress is not wired'));
      return;
    }
    let result;
    try {
      result = host.dispatch(record.operation, record.args);
    } catch (error) {
      settle(record, false, error);
      return;
    }
    if (result && typeof result.then === 'function') {
      result.then(function (value) { settle(record, true, value); },
                  function (error) { settle(record, false, error); });
    } else {
      settle(record, true, result);
    }
  };
  const expire = function () {
    if (terminated || ready) return;
    terminated = true;
    timer = null;
    const batch = pending.splice(0, pending.length);
    pendingBytes = 0;
    for (let index = 0; index < batch.length; index += 1) {
      settle(batch[index], false, adapterError('ELECTRON_MBT_ADAPTER_INGRESS_TIMEOUT', 'document ingress did not become ready'));
    }
  };
  const flush = function () {
    if (terminated || ready) return;
    ready = true;
    if (timer !== null) { clearTimeout(timer); timer = null; }
    const batch = pending.splice(0, pending.length);
    pendingBytes = 0;
    for (let index = 0; index < batch.length; index += 1) dispatch(batch[index]);
  };
  const invoke = function (operation, value, hasValue) {
    if (terminated) {
      return Promise.reject(adapterError('ELECTRON_MBT_ADAPTER_INGRESS_UNAVAILABLE', 'document ingress is not available'));
    }
    let args = null;
    let bytes = 0;
    if (hasValue) {
      try {
        args = JSON.stringify(value);
        if (typeof args !== 'string') throw new Error('not JSON');
      } catch (_) {
        return Promise.reject(adapterError('ELECTRON_MBT_ADAPTER_VALUE', 'arguments are not JSON serializable'));
      }
      bytes = utf8Bytes(args);
    }
    if (ready) {
      return new Promise(function (resolve, reject) {
        dispatch({ operation: operation, args: args, resolve: resolve, reject: reject, settled: false });
      });
    }
    return new Promise(function (resolve, reject) {
      if (pending.length >= MAX_CALLS || pendingBytes + bytes > MAX_BYTES) {
        reject(adapterError('ELECTRON_MBT_ADAPTER_QUEUE_FULL', 'document ingress queue is full'));
        return;
      }
      pending.push({ operation: operation, args: args, resolve: resolve, reject: reject, settled: false });
      pendingBytes += bytes;
      if (timer === null) timer = setTimeout(expire, READY_TIMEOUT_MS);
    });
  };
  const addListener = function (topic, callback) {
    if (typeof callback !== 'function') throw new TypeError('adapted listener must be a function');
    let table = listeners.get(topic);
    if (!table) { table = []; listeners.set(topic, table); }
    const record = { callback: callback };
    table.push(record);
    let disposed = false;
    return function () {
      if (disposed) return;
      disposed = true;
      const current = listeners.get(topic);
      if (!current) return;
      const index = current.indexOf(record);
      if (index >= 0) current.splice(index, 1);
    };
  };
  const emit = function (topic, payload) {
    if (TOPICS.indexOf(topic) < 0) throw adapterError('ELECTRON_MBT_ADAPTER_TOPIC', 'unknown adapted topic');
    const table = listeners.get(topic);
    if (!table || table.length === 0) return;
    const snapshot = table.slice();
    for (let index = 0; index < snapshot.length; index += 1) snapshot[index].callback(payload);
  };
  if (host && typeof host.whenReady === 'function') {
    try { host.whenReady(flush); } catch (_) {}
  } else if (host && host.ready === true) {
    flush();
  }
  if (host && typeof host.onEvent === 'function') {
    try { host.onEvent(emit); } catch (_) {}
  }
  const api = Object.freeze({
${members.join(',\n')}
  });
  Object.defineProperty(window, ${JSON.stringify(manifest.name)}, {
    value: api, enumerable: true, configurable: false, writable: false
  });
})();
`;
  return { source, sha256: crypto.createHash('sha256').update(source).digest('hex') };
}

function writeAdapter(manifestPath, outPath) {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const adapter = buildAdapter(manifest);
  fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
  fs.writeFileSync(outPath, adapter.source);
  return adapter;
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--') || argv[i + 1] === undefined) throw new Error(`invalid argument ${argv[i]}`);
    out[argv[i].slice(2)] = argv[++i];
  }
  return out;
}

if (require.main === module) {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (!args.manifest || !args.out) throw new Error('--manifest and --out are required');
    const adapter = writeAdapter(args.manifest, args.out);
    process.stdout.write(`${JSON.stringify({ ok: true, out: path.relative(process.cwd(), path.resolve(args.out)), sha256: adapter.sha256 })}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { buildAdapter, writeAdapter, validate };
