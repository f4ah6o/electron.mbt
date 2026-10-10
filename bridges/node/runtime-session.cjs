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
  constructor(appInfo, options = {}) {
    this.core = require('../../dist/core.cjs');
    this.runtime = this.core.new_runtime();
    this.appInfo = appInfo;
    this.windows = new Map();
    this.ready = false;
    this.terminated = false;
    this.quitting = false;
    this.host = new NativeHost(appInfo.root, options.nativeHostOptions || {});
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
        if (!runtime.ready || runtime.terminated || runtime.quitting) {
          fail('ELECTRON_MBT_INVALID_STATE', 'Window cannot be created before ready');
        }
        const normalized = supportedOptions(options);
        const id = checked(runtime.core.window_reserve(runtime.runtime)).id;
        this.id = id;
        this.webContents = new EventEmitter();
        this.webContents.id = id;
        this.webContents.send = () => fail('ELECTRON_MBT_UNSUPPORTED_API', 'Renderer IPC is not available in M1');
        this._generation = 0;
        this._loading = false;
        this._renderProcessGone = false;
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
        if (this._renderProcessGone) {
          return Promise.reject(runtimeError('ELECTRON_MBT_WEB_PROCESS_TERMINATED',
            'WebKit content process terminated'));
        }
        if (this._loading) {
          // Overlapping navigations need native cancellation acknowledgements
          // which are not an accepted M1 contract. Reject them explicitly.
          return Promise.reject(runtimeError('ELECTRON_MBT_NAVIGATION_IN_PROGRESS',
            'Overlapping loadFile calls are unsupported in experimental M1'));
        }
        let real, generation;
        try {
          real = fileWithin(runtime.appInfo.root, file);
          generation = checked(runtime.core.window_navigate(runtime.runtime, this.id)).generation;
          // Reserve this navigation on the short native control lane before
          // show/close/destroy can observe the new MoonBit document generation.
          runtime.host.request('begin-load', this.id, generation);
          this._generation = generation;
        } catch (error) {
          if (runtime.host.dead) runtime.abort();
          return Promise.reject(error);
        }
        this._loading = true;
        // A worker owns the blocking socket wait, not the Node main thread.
        // The Promise settles on the genuine native didFinishNavigation ACK.
        return runtime.host.requestAsync('load-file', this.id, generation, { file: real }).then(() => {
          if (this._destroyed) fail('ELECTRON_MBT_WINDOW_DESTROYED', 'Window destroyed while loading');
          if (this._generation !== generation) fail('ELECTRON_MBT_STALE_DOCUMENT', 'A later navigation revoked this load');
          this.webContents.emit('did-finish-load');
        }).catch(error => {
          this.webContents.emit('did-fail-load', error);
          throw error;
        }).finally(() => { this._loading = false; });
      }
      show() {
        if (this._destroyed) fail('ELECTRON_MBT_WINDOW_DESTROYED', 'Window destroyed');
        if (this._renderProcessGone) fail('ELECTRON_MBT_WEB_PROCESS_TERMINATED', 'WebKit content process terminated');
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
          if (runtime.host.dead) {
            // An ambiguous native close must invalidate the whole session,
            // not pretend the WKWebView is known to be live again.
            runtime.abort();
          } else if (!this._destroyed) {
            runtime.core.window_cancel_close(runtime.runtime, this.id);
          }
          throw error;
        } finally { this._closing = false; }
      }
      destroy() {
        if (this._destroyed) return;
        try {
          runtime.host.request('destroy-window', this.id, this._generation);
          // A failed native ACK must not emit a misleading closed event or
          // release the MoonBit window while its real WKWebView is still live.
          this._finishDestroy();
        } catch (error) {
          if (runtime.host.dead) runtime.abort();
          throw error;
        }
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
    this.host.on('web-content-gone', details => {
      const window = this.windows.get(details.window);
      if (!window || window._destroyed || window._generation !== details.generation) return;
      try {
        checked(this.core.window_invalidate(this.runtime, details.window, details.generation));
      } catch (error) {
        this.invalidateHost();
        return;
      }
      window._renderProcessGone = true;
      // This experimental signal does not fabricate Electron's
      // render-process-gone classification or exit code.
      window.webContents.emit('runtime-web-content-gone');
      this.app.emit('runtime-web-content-gone', window);
    });
    this.host.process.once('exit', () => {
      if (!this.terminated) this.invalidateHost();
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
    this.quitting = true;
    let prevented = false;
    try {
      this.app.emit('before-quit', { preventDefault() { prevented = true; } });
      if (prevented) { this.quitting = false; return; }
      checked(this.core.dispatch(this.runtime, 'begin-quit'));
    } catch (error) {
      this.quitting = false;
      throw error;
    }
    let graceful = false;
    try {
      for (const window of Array.from(this.windows.values())) window.destroy();
      this.app.emit('will-quit');
      this.host.close();
      graceful = true;
    } finally {
      if (!graceful) this.host.abort();
      this.core.dispatch(this.runtime, 'stop');
      this.terminated = true;
      if (graceful) this.app.emit('quit');
      else this.invalidateWindows();
    }
  }
  invalidateWindows() {
    // Host loss is not a normal close acknowledgment; do not forge the
    // public "closed" event for a window that may have crashed.
    for (const window of this.windows.values()) window._destroyed = true;
    this.windows.clear();
  }
  invalidateHost() {
    if (this.terminated) return;
    this.terminated = true;
    this.ready = false;
    this.host.abort();
    this.core.dispatch(this.runtime, 'stop');
    this.invalidateWindows();
    this.app.emit('runtime-host-gone');
  }
  abort() { this.invalidateHost(); }
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
