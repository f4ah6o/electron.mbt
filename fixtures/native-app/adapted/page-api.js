'use strict';
(function () {
  const TOPICS = Object.freeze(["doc:open", "app:request-close", "update:state"]);
  const MAX_CALLS = 4;
  const MAX_BYTES = 16384;
  const READY_TIMEOUT_MS = 300;
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
    if (terminated) return;
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
    version: function () { return "adapted-fixture"; },
    onOpenDocument: function (callback) { return addListener("doc:open", callback); },
    onCloseRequest: function (callback) { return addListener("app:request-close", callback); },
    onUpdateState: function (callback) { return addListener("update:state", callback); },
    getSettings: function () { return invoke("app:get-settings", null, false); },
    getUpdateState: function (value) { return invoke("app:get-update-state", value, true); }
  });
  Object.defineProperty(window, "api", {
    value: api, enumerable: true, configurable: false, writable: false
  });
})();
