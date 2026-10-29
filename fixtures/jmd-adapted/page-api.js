'use strict';
(function () {
  const TOPICS = Object.freeze(["file:opened", "tab:adopt", "file:changed", "menu:save", "menu:save-as", "menu:export-html", "menu:find", "menu:theme", "menu:action"]);
  const MAX_CALLS = 8;
  const MAX_BYTES = 65536;
  const READY_TIMEOUT_MS = 2000;
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
    try {
      host.onEvent(function (topic, payload) {
        let value = payload;
        if (typeof payload === 'string') {
          try { value = JSON.parse(payload); } catch (_) {}
        }
        emit(topic, value);
      });
    } catch (_) {}
  }
  const call = function (operation, value) { return invoke(operation, value, true); };
  const send = function (operation, value) { invoke(operation, value, true).catch(function () {}); };
  const listener = function (topic) { return function (callback) { return addListener(topic, callback); }; };
  const splitPath = function (value) { return String(value).split(/[\\/]/); };
  const basename = function (filePath) {
    if (!filePath) return null;
    const parts = splitPath(filePath).filter(Boolean);
    return parts.length ? parts[parts.length - 1] : null;
  };
  const isAbsolute = function (value) {
    return value.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(value);
  };
  const resolveSegments = function (baseFile, relative) {
    const parts = isAbsolute(relative)
      ? splitPath(relative)
      : splitPath(baseFile).slice(0, -1).concat(splitPath(relative));
    const out = [];
    for (let index = 0; index < parts.length; index += 1) {
      const part = parts[index];
      if (!part || part === '.') continue;
      if (part === '..') out.pop();
      else out.push(part);
    }
    return out;
  };
  const resolveAsset = function (baseFile, relative) {
    if (!relative) return null;
    if (!baseFile && !isAbsolute(relative)) return null;
    const segments = resolveSegments(baseFile || '', relative);
    if (!segments.length) return null;
    return 'jmd-file://local/' + segments.map(encodeURIComponent).join('/');
  };
  const jmd = Object.freeze({
    platform: 'linux',
    versions: {},
    readFile: function (filePath) { return call('file:read', [filePath]); },
    droppedFilePath: function () {
      return Promise.reject(adapterError('ELECTRON_MBT_UNSUPPORTED_API', 'webUtils.getPathForFile is not implemented in the adapted profile'));
    },
    save: function (payload) { return call('file:save', [payload]); },
    saveAs: function (payload) { return call('file:save-as', [payload]); },
    exportHtml: function (payload) { return call('file:export-html', [payload]); },
    confirmClose: function (name) { return call('dialog:confirm-close', [name]); },
    detachTab: function (payload) { return call('tab:detach', [payload]); },
    watchFiles: function (paths) { send('files:watch', [paths]); },
    openExternal: function (url) { return call('shell:open-external', [url]); },
    showInFolder: function (filePath) { return call('shell:show-item', [filePath]); },
    setMenuAccelerators: function (map) { send('menu:accelerators', [map]); },
    setTitle: function (title) { send('window:set-title', [title]); },
    setEdited: function (edited) { send('window:set-edited', [edited]); },
    setRepresentedFile: function (filePath) { send('window:set-represented-file', [filePath]); },
    closeWindow: function () { send('window:close'); },
    resolveAsset: resolveAsset,
    basename: basename,
    onFileOpened: listener('file:opened'),
    onTabAdopt: listener('tab:adopt'),
    onFileChanged: listener('file:changed'),
    onMenuSave: listener('menu:save'),
    onMenuSaveAs: listener('menu:save-as'),
    onMenuExportHtml: listener('menu:export-html'),
    onMenuFind: listener('menu:find'),
    onMenuTheme: listener('menu:theme'),
    onMenuAction: listener('menu:action'),
  });
  // Adapted-profile substitution for the native menu accelerator: the native
  // menu is store-only, so bind the renderer's own Ctrl+S to its own save().
  // This is a page adaptation, not native menu installation.
  window.addEventListener('keydown', function (event) {
    if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey &&
        typeof event.key === 'string' && event.key.toLowerCase() === 's') {
      const app = window.__jmd;
      if (app && typeof app.save === 'function') {
        event.preventDefault();
        event.stopPropagation();
        Promise.resolve(app.save()).catch(function () {});
      }
    }
  }, true);

  Object.defineProperty(window, 'jmd', {
    value: jmd, enumerable: true, configurable: false, writable: false
  });
})();
