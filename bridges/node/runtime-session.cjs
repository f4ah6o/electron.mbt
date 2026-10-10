'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { NativeHost } = require('./native-host.cjs');
const { runtimeError } = require('./errors.cjs');

let active = null;
function fail(code, detail) { throw runtimeError(code, detail); }
function checked(json) {
  const value = JSON.parse(json);
  if (!value.ok) fail('ELECTRON_MBT_' + (value.code || 'INVALID_STATE'), 'MoonBit rejected lifecycle transition');
  return value;
}
function supportedOptions(options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    fail('ELECTRON_MBT_UNSUPPORTED_API', 'BrowserWindow expects ordinary options');
  }
  for (const key of Object.keys(options)) {
    if (!['width', 'height', 'title', 'show', 'webPreferences'].includes(key)) {
      fail('ELECTRON_MBT_UNSUPPORTED_API', 'BrowserWindow.' + key + ' is not implemented in M1');
    }
  }
  const preferences = options.webPreferences ?? {};
  if (!preferences || typeof preferences !== 'object' || Array.isArray(preferences)) {
    fail('ELECTRON_MBT_UNSUPPORTED_API', 'Invalid webPreferences');
  }
  for (const [key, value] of Object.entries(preferences)) {
    if (!['nodeIntegration', 'contextIsolation', 'sandbox', 'webSecurity'].includes(key)) {
      fail('ELECTRON_MBT_UNSUPPORTED_API', 'webPreferences.' + key + ' is not implemented in M1');
    }
    if ((key === 'nodeIntegration' && value !== false) ||
        (key !== 'nodeIntegration' && value !== true)) {
      fail('ELECTRON_MBT_UNSUPPORTED_API', 'Unsafe webPreferences.' + key + ' is unsupported');
    }
  }
  const width = options.width ?? 800;
  const height = options.height ?? 600;
  const title = options.title ?? '';
  const show = options.show ?? true;
  if (!Number.isInteger(width) || width < 100 || width > 4096 ||
      !Number.isInteger(height) || height < 100 || height > 4096 ||
      typeof title !== 'string' || title.length > 256 || typeof show !== 'boolean') {
    fail('ELECTRON_MBT_UNSUPPORTED_API', 'Unsupported BrowserWindow options');
  }
  return { width, height, title, show };
}
function fileWithin(root, file) {
  if (typeof file !== 'string' || !file || file.includes('\0')) {
    fail('ELECTRON_MBT_INVALID_ARGUMENT', 'Expected a local HTML file path');
  }
  const real = fs.realpathSync(path.resolve(root, file));
  if (!real.startsWith(root + path.sep) || !fs.statSync(real).isFile()) {
    fail('ELECTRON_MBT_FILE_DENIED', 'Requested file is outside application root');
  }
  return real;
}
class ExperimentalRuntime {
  constructor(appInfo) {
    this.core = require('../../dist/core.cjs');
    this.runtime = this.core.new_runtime();
    this.appInfo = appInfo;
    this.windows = new Map();
    this.ready = false;
    this.terminated = false;
    this.quitting = false;
    this.host = new NativeHost(appInfo.root);
    try {
      this.host.request('hello');
      this.host.request('ready');
    } catch (error) { this.host.abort(); throw error; }
    this.readyPromise = new Promise(resolve => { this.resolveReady = resolve; });
    const app = new EventEmitter();
    app.whenReady = () => this.readyPromise;
    app.isReady = () => this.ready;
    app.quit = () => this.quit();
    app.getName = () => appInfo.name;
    app.getVersion = () => appInfo.version;
    app.getAppPath = () => appInfo.root;
    this.app = app;
    const runtime = this;
    this.BrowserWindow = class BrowserWindow extends EventEmitter {
      constructor(options) {
        super();
        if (!runtime.ready || runtime.terminated) {
          fail('ELECTRON_MBT_INVALID_STATE', 'Window cannot be created before ready');
        }
        const normalized = supportedOptions(options);
        const id = checked(runtime.core.window_reserve(runtime.runtime)).id;
        this.id = id;
        this.webContents = new EventEmitter();
        this.webContents.id = id;
        this.webContents.send = () => fail('ELECTRON_MBT_UNSUPPORTED_API', 'Renderer IPC is not available in M1');
        this._generation = 0;
        this._destroyed = false;
        this._closing = false;
        try {
          const created = runtime.host.request('create-window', id, 0, normalized);
          if (created.webViewAttached !== true) {
            fail('ELECTRON_MBT_NATIVE_FAILURE', 'Host did not attach WKWebView');
          }
          checked(runtime.core.window_confirm(runtime.runtime, id));
          runtime.windows.set(id, this);
        } catch (error) {
          runtime.core.window_destroy(runtime.runtime, id);
          throw error;
        }
      }
      static getAllWindows() { return Array.from(runtime.windows.values()); }
      isDestroyed() { return this._destroyed; }
      loadFile(file) {
        if (this._destroyed) {
          return Promise.reject(runtimeError('ELECTRON_MBT_WINDOW_DESTROYED', 'Window destroyed'));
        }
        let real, generation;
        try {
          real = fileWithin(runtime.appInfo.root, file);
          generation = checked(runtime.core.window_navigate(runtime.runtime, this.id)).generation;
          this._generation = generation;
        } catch (error) { return Promise.reject(error); }
        // A Promise surface does not imply that the synchronous native call
        // provides Electron-equivalent rendering/event-loop scheduling.
        return Promise.resolve().then(() => {
          if (this._destroyed) fail('ELECTRON_MBT_WINDOW_DESTROYED', 'Window destroyed before loading');
          if (this._generation !== generation) {
            fail('ELECTRON_MBT_STALE_DOCUMENT', 'A newer load invalidated this document generation');
          }
          runtime.host.request('load-file', this.id, generation, { file: real });
          if (this._destroyed) fail('ELECTRON_MBT_WINDOW_DESTROYED', 'Window destroyed while loading');
          this.webContents.emit('did-finish-load');
        }).catch(error => {
          this.webContents.emit('did-fail-load', error);
          throw error;
        });
      }
      show() {
        if (this._destroyed) fail('ELECTRON_MBT_WINDOW_DESTROYED', 'Window destroyed');
        runtime.host.request('show-window', this.id, this._generation);
      }
      close() {
        if (this._destroyed || this._closing) return;
        this._closing = true;
        checked(runtime.core.window_begin_close(runtime.runtime, this.id));
        let prevented = false;
        const event = { preventDefault() { prevented = true; } };
        try {
          this.emit('close', event);
          if (this._destroyed) return;
          if (prevented) {
            checked(runtime.core.window_cancel_close(runtime.runtime, this.id));
            return;
          }
          runtime.host.request('close-window', this.id, this._generation);
          this._finishDestroy();
        } catch (error) {
          if (!this._destroyed) runtime.core.window_cancel_close(runtime.runtime, this.id);
          throw error;
        } finally { this._closing = false; }
      }
      destroy() {
        if (this._destroyed) return;
        try { runtime.host.request('destroy-window', this.id, this._generation); }
        finally { this._finishDestroy(); }
      }
      _finishDestroy() {
        if (this._destroyed) return;
        this._destroyed = true;
        runtime.core.window_destroy(runtime.runtime, this.id);
        runtime.windows.delete(this.id);
        this.emit('closed');
        if (runtime.windows.size === 0 && !runtime.terminated) {
          runtime.app.emit('window-all-closed');
        }
      }
      getBounds() {
        fail('ELECTRON_MBT_UNSUPPORTED_API', 'Real native bounds are not exposed by M1');
      }
    };
    this.host.process.once('exit', () => {
      if (!this.terminated) {
        this.terminated = true;
        for (const window of Array.from(this.windows.values())) window._finishDestroy();
        this.app.emit('runtime-host-gone');
      }
    });
  }
  start() {
    queueMicrotask(() => {
      if (this.terminated) return;
      try {
        checked(this.core.dispatch(this.runtime, 'ready'));
        this.ready = true;
        this.app.emit('ready');
        this.resolveReady();
      } catch (error) {
        this.abort();
        process.nextTick(() => { throw error; });
      }
    });
  }
  quit() {
    if (this.terminated || this.quitting) return;
    let prevented = false;
    this.app.emit('before-quit', { preventDefault() { prevented = true; } });
    if (prevented) return;
    checked(this.core.dispatch(this.runtime, 'begin-quit'));
    this.quitting = true;
    try {
      for (const window of Array.from(this.windows.values())) window.destroy();
      this.app.emit('will-quit');
      this.host.close();
    } finally {
      this.core.dispatch(this.runtime, 'stop');
      this.terminated = true;
      this.app.emit('quit');
    }
  }
  abort() {
    if (this.terminated) return;
    this.terminated = true;
    this.host.abort();
    this.core.dispatch(this.runtime, 'stop');
  }
}
function attach(session) {
  if (active) fail('ELECTRON_MBT_INVALID_STATE', 'Runtime session already active');
  active = session;
}
function current() {
  if (!active) fail('ELECTRON_MBT_INVALID_STATE', 'No active runtime session');
  return active;
}
function detach(session) { if (active === session) active = null; }
module.exports = { ExperimentalRuntime, attach, current, detach };
