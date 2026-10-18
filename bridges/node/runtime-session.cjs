'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { types } = require('node:util');
const { NativeHost } = require('./native-host.cjs');
const { runtimeError } = require('./errors.cjs');
const { readPreload } = require('./preload-file.cjs');

let active = null;
function fail(code, detail) { throw runtimeError(code, detail); }
function checked(json) {
  const value = JSON.parse(json);
  if (!value.ok) fail('ELECTRON_MBT_' + (value.code || 'INVALID_STATE'), 'MoonBit rejected lifecycle transition');
  return value;
}
function supportedTitle(value) {
  return typeof value === 'string' && value.length <= 256 && value.isWellFormed();
}
function supportedColor(value) {
  return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value);
}
function supportedDimension(value) {
  return Number.isInteger(value) && value >= 0 && value <= 4096;
}
function within(root, target) {
  const relative = path.relative(root, target);
  return relative === '' || (!path.isAbsolute(relative) && !relative.startsWith('..' + path.sep) && relative !== '..');
}
function safeAppName(value) {
  return String(value || 'app').replace(/[^A-Za-z0-9._-]/g, '_') || 'app';
}
function validBoundsCoordinate(value) {
  return Number.isSafeInteger(value) && !Object.is(value, -0) && Math.abs(value) <= 1048576;
}
function validBoundsDimension(value, writable = false) {
  return Number.isSafeInteger(value) && value >= (writable ? 100 : 1) &&
    value <= (writable ? 4096 : 32768);
}
function checkedBounds(runtime, bounds) {
  const keys = bounds && typeof bounds === 'object' && !Array.isArray(bounds) ?
    Object.keys(bounds).sort() : [];
  if (keys.join(',') !== 'height,width,x,y' ||
      !validBoundsCoordinate(bounds.x) || !validBoundsCoordinate(bounds.y) ||
      !validBoundsDimension(bounds.width) || !validBoundsDimension(bounds.height)) {
    runtime.abort();
    fail('ELECTRON_MBT_PROTOCOL', 'Malformed native window bounds acknowledgement');
  }
  return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height };
}
function normalizedPartialBounds(bounds, animate) {
  if (animate !== undefined && animate !== false) {
    fail('ELECTRON_MBT_UNSUPPORTED_API', 'Animated bounds changes are not supported in M1');
  }
  if (!bounds || typeof bounds !== 'object' || Array.isArray(bounds) || types.isProxy(bounds) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(bounds))) {
    fail('ELECTRON_MBT_INVALID_ARGUMENT', 'Expected plain bounds object');
  }
  const input = Object.getOwnPropertyDescriptors(bounds);
  const copy = {};
  for (const key of Reflect.ownKeys(input)) {
    const field = input[key];
    if (typeof key !== 'string' || !['x', 'y', 'width', 'height'].includes(key) ||
        !field.enumerable || !Object.hasOwn(field, 'value')) {
      fail('ELECTRON_MBT_INVALID_ARGUMENT', 'Invalid bounds property');
    }
    const valid = key === 'x' || key === 'y' ?
      validBoundsCoordinate(field.value) : validBoundsDimension(field.value, true);
    if (!valid) fail('ELECTRON_MBT_INVALID_ARGUMENT', 'Out-of-range bounds property');
    copy[key] = field.value;
  }
  return copy;
}
function supportedOptions(options = {}, appRoot) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    fail('ELECTRON_MBT_UNSUPPORTED_API', 'BrowserWindow expects ordinary options');
  }
  for (const key of Object.keys(options)) {
    if (!['width', 'height', 'x', 'y', 'minWidth', 'minHeight', 'title', 'show',
      'backgroundColor', 'autoHideMenuBar', 'icon', 'webPreferences'].includes(key)) {
      fail('ELECTRON_MBT_UNSUPPORTED_API', 'BrowserWindow.' + key + ' is not implemented in M1');
    }
  }
  const preferences = options.webPreferences ?? {};
  if (!preferences || typeof preferences !== 'object' || Array.isArray(preferences)) {
    fail('ELECTRON_MBT_UNSUPPORTED_API', 'Invalid webPreferences');
  }
  for (const [key, value] of Object.entries(preferences)) {
    if (!['nodeIntegration', 'contextIsolation', 'sandbox', 'webSecurity', 'preload'].includes(key)) {
      fail('ELECTRON_MBT_UNSUPPORTED_API', 'webPreferences.' + key + ' is not implemented in M1');
    }
    if (key === 'preload') continue;
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
      !supportedTitle(title) || typeof show !== 'boolean') {
    fail('ELECTRON_MBT_UNSUPPORTED_API', 'Unsupported BrowserWindow options');
  }
  for (const key of ['x', 'y']) {
    if (options[key] !== undefined && (!Number.isInteger(options[key]) || Math.abs(options[key]) > 1048576)) {
      fail('ELECTRON_MBT_UNSUPPORTED_API', `Unsupported BrowserWindow.${key}`);
    }
  }
  for (const key of ['minWidth', 'minHeight']) {
    if (options[key] !== undefined && !supportedDimension(options[key])) {
      fail('ELECTRON_MBT_UNSUPPORTED_API', `Unsupported BrowserWindow.${key}`);
    }
  }
  if (options.backgroundColor !== undefined && !supportedColor(options.backgroundColor)) {
    fail('ELECTRON_MBT_UNSUPPORTED_API', 'BrowserWindow.backgroundColor must be #rrggbb');
  }
  if (options.autoHideMenuBar !== undefined && typeof options.autoHideMenuBar !== 'boolean') {
    fail('ELECTRON_MBT_UNSUPPORTED_API', 'BrowserWindow.autoHideMenuBar must be boolean');
  }
  if (options.icon !== undefined) fileWithin(appRoot, options.icon);
  const normalized = { width, height, title, show };
  for (const key of ['x', 'y', 'minWidth', 'minHeight', 'backgroundColor']) {
    if (options[key] !== undefined) normalized[key] = options[key];
  }
  if (options.icon !== undefined) normalized.icon = options.icon;
  if (options.autoHideMenuBar !== undefined) normalized.autoHideMenuBar = options.autoHideMenuBar;
  if (Object.hasOwn(preferences, 'preload')) {
    Object.assign(normalized, readPreload(appRoot, preferences.preload));
  }
  return normalized;
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
    this.readyPromise = new Promise((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });
    // A runtime may fail before its app main attaches a whenReady handler.
    // The observable promise must reject, but must not trigger an unhandled
    // rejection simply because no user code had an opportunity to subscribe.
    this.readyPromise.catch(() => {});
    const runtime = this;
    const explicitRoot = options.userDataRoot || process.env.ELECTRON_MBT_M1_USER_DATA_ROOT;
    this.userDataRoot = path.resolve(explicitRoot || fs.mkdtempSync(path.join(os.tmpdir(), 'electron-mbt-m1-')));
    fs.mkdirSync(this.userDataRoot, { recursive: true });
    this.appName = appInfo.name;
    this.appPaths = {
      appData: path.join(this.userDataRoot, 'appData'),
      userData: path.join(this.userDataRoot, 'userData', safeAppName(appInfo.name)),
      temp: path.join(this.userDataRoot, 'temp'),
      home: path.join(this.userDataRoot, 'home'),
      logs: path.join(this.userDataRoot, 'logs'),
    };
    for (const directory of Object.values(this.appPaths)) fs.mkdirSync(directory, { recursive: true });
    const appTarget = new EventEmitter();
    const app = new Proxy(appTarget, {
      get(target, property, receiver) {
        if (typeof property === 'symbol' || property in target) return Reflect.get(target, property, receiver);
        fail('ELECTRON_MBT_UNSUPPORTED_API',
          `app.${String(property)} is not available in the experimental M1 profile`);
      },
    });
    app.whenReady = () => this.readyPromise;
    app.isReady = () => this.ready;
    app.quit = () => this.quit();
    app.getName = () => this.appName;
    app.getVersion = () => appInfo.version;
    app.getAppPath = () => appInfo.root;
    app.setName = name => {
      if (typeof name !== 'string' || name.length === 0 || name.length > 256 || !name.isWellFormed()) {
        fail('ELECTRON_MBT_INVALID_ARGUMENT', 'app.setName expects a non-empty well-formed string');
      }
      this.appName = name;
    };
    Object.defineProperty(app, 'name', { enumerable: true, get: () => this.appName });
    Object.defineProperty(app, 'isPackaged', { enumerable: true, get: () => false });
    app.getLocale = () => Intl.DateTimeFormat().resolvedOptions().locale;
    app.requestSingleInstanceLock = () => this.requestSingleInstanceLock();
    app.releaseSingleInstanceLock = () => this.releaseSingleInstanceLock();
    app.getPath = name => {
      if (typeof name !== 'string') fail('ELECTRON_MBT_INVALID_ARGUMENT', 'app.getPath expects a string');
      if (name === 'exe') return process.execPath;
      if (name === 'documents' || name === 'desktop' || name === 'downloads') {
        const directory = path.join(this.appPaths.home, name);
        fs.mkdirSync(directory, { recursive: true });
        return directory;
      }
      if (!Object.hasOwn(this.appPaths, name)) fail('ELECTRON_MBT_INVALID_ARGUMENT', `Unknown app path ${name}`);
      return this.appPaths[name];
    };
    app.setPath = (name, value) => {
      if (name !== 'userData' && name !== 'logs' && name !== 'temp') {
        fail('ELECTRON_MBT_INVALID_ARGUMENT', `app.setPath does not support ${String(name)} in the experimental M1 profile`);
      }
      if (typeof value !== 'string' || value.length === 0 || value.includes('\0') || !value.isWellFormed() || !path.isAbsolute(value)) {
        fail('ELECTRON_MBT_INVALID_ARGUMENT', 'app.setPath expects an absolute well-formed path');
      }
      const resolved = path.resolve(value);
      if (!within(this.userDataRoot, resolved) || resolved === this.userDataRoot) {
        fail('ELECTRON_MBT_FILE_DENIED', 'app.setPath target is outside the isolated user-data root');
      }
      fs.mkdirSync(resolved, { recursive: true });
      if (!fs.statSync(resolved).isDirectory()) fail('ELECTRON_MBT_INVALID_ARGUMENT', 'app.setPath target is not a directory');
      this.appPaths[name] = resolved;
    };
    this.app = app;
    this.BrowserWindow = class BrowserWindow extends EventEmitter {
      constructor(options) {
        super();
        if (!runtime.ready || runtime.terminated || runtime.quitting) {
          fail('ELECTRON_MBT_INVALID_STATE', 'Window cannot be created before ready');
        }
        const normalized = supportedOptions(options, runtime.appInfo.root);
        const id = checked(runtime.core.window_reserve(runtime.runtime)).id;
        this.id = id;
        this.webContents = new EventEmitter();
        this.webContents.id = id;
        this.webContents.send = () => fail('ELECTRON_MBT_UNSUPPORTED_API', 'Renderer IPC is not available in M1');
        this.webContents.setWindowOpenHandler = handler => {
          if (typeof handler !== 'function') {
            fail('ELECTRON_MBT_INVALID_ARGUMENT', 'setWindowOpenHandler expects a function');
          }
          // Retain main-local intent, but native window.open remains denied by
          // the M1 host and this handler is not invoked on a native request yet.
          this._windowOpenHandler = handler;
        };
        this.webContents.getURL = () => {
          if (this._destroyed) fail('ELECTRON_MBT_WINDOW_DESTROYED', 'Window destroyed');
          if (this._renderProcessGone) {
            fail('ELECTRON_MBT_WEB_PROCESS_TERMINATED', 'WebKit content process terminated');
          }
          const acknowledgement = runtime.host.request('get-web-contents-url', this.id, this._generation);
          if (typeof acknowledgement.url !== 'string' || acknowledgement.url.length > 8192 ||
              !acknowledgement.url.isWellFormed()) {
            runtime.abort();
            fail('ELECTRON_MBT_PROTOCOL', 'Malformed native web contents URL acknowledgement');
          }
          return acknowledgement.url;
        };
        this.webContents.getTitle = () => {
          if (this._destroyed) fail('ELECTRON_MBT_WINDOW_DESTROYED', 'Window destroyed');
          if (this._renderProcessGone) {
            fail('ELECTRON_MBT_WEB_PROCESS_TERMINATED', 'WebKit content process terminated');
          }
          const acknowledgement = runtime.host.request('get-web-contents-title', this.id, this._generation);
          if (typeof acknowledgement.title !== 'string' || acknowledgement.title.length > 4096 ||
              !acknowledgement.title.isWellFormed()) {
            runtime.abort();
            fail('ELECTRON_MBT_PROTOCOL', 'Malformed native web contents title acknowledgement');
          }
          return acknowledgement.title;
        };
        this._generation = 0;
        this._preloadSource = normalized.preloadSource;
        this._loading = false;
        this._renderProcessGone = false;
        this._destroyed = false;
        this._closing = false;
        this._cancelledNativeCloseThrough = 0;
        this._autoHideMenuBar = normalized.autoHideMenuBar === true;
        this._icon = normalized.icon;
        try {
          const createPayload = {
            width: normalized.width, height: normalized.height,
            title: normalized.title, show: normalized.show,
          };
          if (normalized.preloadSource !== undefined) {
            createPayload.preloadSource = normalized.preloadSource;
            createPayload.preloadSHA256 = normalized.preloadSHA256;
          }
          const created = runtime.host.request('create-window', id, 0, createPayload);
          if (created.webViewAttached !== true) {
            fail('ELECTRON_MBT_NATIVE_FAILURE', 'Host did not attach WKWebView');
          }
          if (normalized.x !== undefined || normalized.y !== undefined) {
            runtime.host.request('set-window-bounds', id, 0, {
              x: normalized.x ?? 0, y: normalized.y ?? 0,
              width: normalized.width, height: normalized.height,
            });
          }
          if (normalized.minWidth !== undefined || normalized.minHeight !== undefined) {
            runtime.host.request('set-window-min-size', id, 0, {
              width: normalized.minWidth ?? 0, height: normalized.minHeight ?? 0,
            });
          }
          if (normalized.backgroundColor !== undefined) {
            runtime.host.request('set-window-background-color', id, 0, { color: normalized.backgroundColor });
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
        let moonbitGenerationAdvanced = false;
        try {
          real = fileWithin(runtime.appInfo.root, file);
          generation = checked(runtime.core.window_navigate(runtime.runtime, this.id)).generation;
          moonbitGenerationAdvanced = true;
          // Reserve this navigation on the short native control lane before
          // show/close/destroy can observe the new MoonBit document generation.
          runtime.host.request('begin-load', this.id, generation);
          this._generation = generation;
          if (runtime.bridgeSources) {
            // Preview the unchanged preload in a disposable VM to discover its
            // single contextBridge key, then install host-owned sources plus
            // that key before load-file. The host re-verifies source hashes and
            // the real WKWebView descriptor must match the key.
            const sources = runtime.transportSourcesForPreload(this._preloadSource);
            runtime.host.request('install-preload-bridge', this.id, generation, sources);
          }
        } catch (error) {
          // MoonBit generations are monotonic. Once the core advanced, a
          // failed native reservation cannot be rolled back to the old
          // privilege generation. Tear down both peers instead.
          if (moonbitGenerationAdvanced || runtime.host.dead) runtime.abort();
          return Promise.reject(error);
        }
        this._loading = true;
        // A worker owns the blocking socket wait, not the Node main thread.
        // The Promise settles on the genuine native didFinishNavigation ACK.
        return runtime.host.requestAsync('load-file', this.id, generation, { file: real }).then(
          () => {
            // Native completion is terminal before a listener can navigate again.
            // A listener exception must not be misreported as a native load failure.
            this._loading = false;
            if (this._destroyed) fail('ELECTRON_MBT_WINDOW_DESTROYED', 'Window destroyed while loading');
            if (this._generation !== generation) fail('ELECTRON_MBT_STALE_DOCUMENT', 'A later navigation revoked this load');
            this.webContents.emit('did-finish-load');
          },
          error => {
            this._loading = false;
            let reported = error;
            if (error && error.code === 'ELECTRON_MBT_PRELOAD_UNSUPPORTED_API' && !runtime.host.dead) {
              try {
                const status = runtime.host.request('get-preload-status', this.id, this._generation);
                if (status.status === 'unsupported' && typeof status.detail === 'string' &&
                    status.detail.length > 0 && status.detail.length <= 128) {
                  reported = runtimeError(error.code, `Preload requested unsupported API: ${status.detail}`);
                }
              } catch {}
            }
            if (!this._destroyed) this.webContents.emit('did-fail-load', reported);
            throw reported;
          },
        );
      }
      show() {
        if (this._destroyed) fail('ELECTRON_MBT_WINDOW_DESTROYED', 'Window destroyed');
        if (this._renderProcessGone) fail('ELECTRON_MBT_WEB_PROCESS_TERMINATED', 'WebKit content process terminated');
        const acknowledgement = runtime.host.request('show-window', this.id, this._generation);
        if (acknowledgement.visible !== true) {
          runtime.abort();
          fail('ELECTRON_MBT_PROTOCOL', 'Native window did not confirm visibility');
        }
      }
      hide() {
        if (this._destroyed) fail('ELECTRON_MBT_WINDOW_DESTROYED', 'Window destroyed');
        const acknowledgement = runtime.host.request('hide-window', this.id, this._generation);
        if (acknowledgement.visible !== false) {
          runtime.abort();
          fail('ELECTRON_MBT_PROTOCOL', 'Native window did not confirm hiding');
        }
      }
      isVisible() {
        if (this._destroyed) fail('ELECTRON_MBT_WINDOW_DESTROYED', 'Window destroyed');
        const acknowledgement = runtime.host.request('is-window-visible', this.id, this._generation);
        if (typeof acknowledgement.visible !== 'boolean') {
          runtime.abort();
          fail('ELECTRON_MBT_PROTOCOL', 'Malformed native visibility acknowledgement');
        }
        return acknowledgement.visible;
      }
      getTitle() {
        if (this._destroyed) fail('ELECTRON_MBT_WINDOW_DESTROYED', 'Window destroyed');
        const acknowledgement = runtime.host.request('get-window-title', this.id, this._generation);
        if (typeof acknowledgement.title !== 'string' || acknowledgement.title.length > 256) {
          runtime.abort();
          fail('ELECTRON_MBT_PROTOCOL', 'Malformed native title acknowledgement');
        }
        return acknowledgement.title;
      }
      setTitle(title) {
        if (this._destroyed) fail('ELECTRON_MBT_WINDOW_DESTROYED', 'Window destroyed');
        if (!supportedTitle(title)) {
          fail('ELECTRON_MBT_INVALID_ARGUMENT', 'Expected a well-formed window title of at most 256 code units');
        }
        const acknowledgement = runtime.host.request('set-window-title', this.id, this._generation, { title });
        if (acknowledgement.title !== title) {
          runtime.abort();
          fail('ELECTRON_MBT_PROTOCOL', 'Native title acknowledgement mismatch');
        }
      }
      _ackCancelledClose() {
        const acknowledgement = runtime.host.request('cancel-close', this.id, this._generation);
        const requestID = acknowledgement.cancelledNativeRequest;
        if (!Number.isSafeInteger(requestID) || requestID < 0) {
          runtime.abort();
          fail('ELECTRON_MBT_PROTOCOL', 'Malformed native close cancellation acknowledgement');
        }
        this._cancelledNativeCloseThrough =
          Math.max(this._cancelledNativeCloseThrough, requestID);
      }
      close() {
        if (this._destroyed || this._closing) return;
        this._closing = true;
        let beganClose = false;
        let nativeAcknowledged = false;
        const event = { preventDefault() { this.defaultPrevented = true; }, defaultPrevented: false };
        try {
          checked(runtime.core.window_begin_close(runtime.runtime, this.id));
          beganClose = true;
          this.emit('close', event);
          if (this._destroyed) return;
          if (event.defaultPrevented) {
            // OS close gestures are not dispatched again until native ACKs
            // that main has restored the window to its Live state.
            this._ackCancelledClose();
            checked(runtime.core.window_cancel_close(runtime.runtime, this.id));
            beganClose = false;
            return;
          }
          runtime.host.request('close-window', this.id, this._generation);
          nativeAcknowledged = true;
          this._finishDestroy();
        } catch (error) {
          if (runtime.host.dead || nativeAcknowledged) {
            // Unknown native outcome must never resurrect a closed OS window.
            runtime.abort();
          } else if (beganClose && !this._destroyed) {
            try {
              this._ackCancelledClose();
              checked(runtime.core.window_cancel_close(runtime.runtime, this.id));
            } catch (cleanupError) {
              runtime.abort();
            }
          }
          throw error;
        } finally {
          this._closing = false;
        }
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
        if (runtime.windows.size === 0 && !runtime.terminated && !runtime.quitting) {
          runtime.app.emit('window-all-closed');
        }
      }
      getBounds() {
        if (this._destroyed) fail('ELECTRON_MBT_WINDOW_DESTROYED', 'Window destroyed');
        return checkedBounds(runtime, runtime.host.request('get-window-bounds', this.id, this._generation));
      }
      setBounds(bounds, animate = false) {
        if (this._destroyed) fail('ELECTRON_MBT_WINDOW_DESTROYED', 'Window destroyed');
        const partial = normalizedPartialBounds(bounds, animate);
        checkedBounds(runtime, runtime.host.request('set-window-bounds', this.id, this._generation, partial));
      }
      getSize() {
        const { width, height } = this.getBounds();
        return [width, height];
      }
      setSize(width, height, animate = false) {
        this.setBounds({ width, height }, animate);
      }
      getPosition() {
        const { x, y } = this.getBounds();
        return [x, y];
      }
      setPosition(x, y, animate = false) {
        this.setBounds({ x, y }, animate);
      }
      getMinimumSize() {
        if (this._destroyed) fail('ELECTRON_MBT_WINDOW_DESTROYED', 'Window destroyed');
        const acknowledgement = runtime.host.request('get-window-min-size', this.id, this._generation);
        if (!Number.isInteger(acknowledgement.width) || acknowledgement.width < 0 || acknowledgement.width > 4096 ||
            !Number.isInteger(acknowledgement.height) || acknowledgement.height < 0 || acknowledgement.height > 4096) {
          runtime.abort();
          fail('ELECTRON_MBT_PROTOCOL', 'Malformed native minimum-size acknowledgement');
        }
        return [acknowledgement.width, acknowledgement.height];
      }
      setMinimumSize(width, height) {
        if (this._destroyed) fail('ELECTRON_MBT_WINDOW_DESTROYED', 'Window destroyed');
        if (!supportedDimension(width) || !supportedDimension(height)) {
          fail('ELECTRON_MBT_INVALID_ARGUMENT', 'setMinimumSize expects integer dimensions from 0 to 4096');
        }
        runtime.host.request('set-window-min-size', this.id, this._generation, { width, height });
      }
      getBackgroundColor() {
        if (this._destroyed) fail('ELECTRON_MBT_WINDOW_DESTROYED', 'Window destroyed');
        const acknowledgement = runtime.host.request('get-window-background-color', this.id, this._generation);
        if (!supportedColor(acknowledgement.color)) {
          runtime.abort();
          fail('ELECTRON_MBT_PROTOCOL', 'Malformed native background-colour acknowledgement');
        }
        return acknowledgement.color;
      }
      setBackgroundColor(color) {
        if (this._destroyed) fail('ELECTRON_MBT_WINDOW_DESTROYED', 'Window destroyed');
        if (!supportedColor(color)) {
          fail('ELECTRON_MBT_INVALID_ARGUMENT', 'setBackgroundColor expects #rrggbb');
        }
        runtime.host.request('set-window-background-color', this.id, this._generation, { color });
      }
    };
    this.host.on('native-close-request', details => {
      if (this.terminated || this.quitting) return;
      const window = this.windows.get(details.window);
      if (!window || window._destroyed) return;
      // A programmatic close may have cancelled this OS gesture *before*
      // the serial native notification was consumed. Never dispatch that
      // same physical gesture a second time.
      if (details.request <= window._cancelledNativeCloseThrough) return;
      if (window._generation !== details.generation) {
        // The physical gesture belonged to an older document. Unlock the
        // native close request instead of dispatching stale UI authority.
        try {
          window._ackCancelledClose();
        } catch (error) { this.invalidateHost(error); }
        return;
      }
      try { window.close(); }
      catch (error) { this.invalidateHost(error); }
    });
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
    // ChildProcess 'error' is not guaranteed to be followed by 'exit'
    // (failed spawn emits 'close'). The host emits a single post-revocation
    // loss signal for error, exit, close and transport failures.
    this.host.on('lost', error => this.invalidateHost(error));
  }
  requestSingleInstanceLock() {
    if (this.singleInstanceLock) return true;
    const lockPath = path.join(this.userDataRoot, 'single-instance.lock');
    const flags = fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY |
      (fs.constants.O_NOFOLLOW || 0);
    let fd;
    try {
      fd = fs.openSync(lockPath, flags, 0o600);
    } catch (error) {
      if (error.code !== 'EEXIST') return false;
      let pid = NaN;
      try { pid = Number(fs.readFileSync(lockPath, 'utf8')); } catch {}
      if (Number.isInteger(pid) && pid > 0) {
        try {
          process.kill(pid, 0);
          return false;
        } catch (probe) {
          if (probe.code !== 'ESRCH') return false;
        }
      }
      try { fs.unlinkSync(lockPath); } catch { return false; }
      try { fd = fs.openSync(lockPath, flags, 0o600); } catch { return false; }
    }
    fs.writeSync(fd, String(process.pid));
    this.singleInstanceLock = { fd, path: lockPath };
    return true;
  }
  releaseSingleInstanceLock() {
    const lock = this.singleInstanceLock;
    if (!lock) return;
    this.singleInstanceLock = null;
    try { fs.closeSync(lock.fd); } catch {}
    try { fs.unlinkSync(lock.path); } catch {}
  }
  start() {
    if (this.host.dead) { this.invalidateHost(); return; }
    queueMicrotask(() => {
      if (this.terminated || this.host.dead) {
        if (!this.terminated) this.invalidateHost();
        return;
      }
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
    let begunQuit = false;
    const hostAlive = () => {
      if (this.terminated) return false;
      if (this.host.dead) {
        this.invalidateHost();
        return false;
      }
      return true;
    };
    try {
      let prevented = false;
      this.app.emit('before-quit', { preventDefault() { prevented = true; } });
      if (!hostAlive() || prevented) return;
      checked(this.core.dispatch(this.runtime, 'begin-quit'));
      begunQuit = true;
      // Do not call destroy(): app.quit() must offer every window a
      // cancellable close before the native host is shut down.
      for (const window of Array.from(this.windows.values())) {
        if (!hostAlive()) return;
        window.close();
        // Host loss also marks windows destroyed, but is not proof of
        // successful native close acknowledgements.
        if (!hostAlive() || !window.isDestroyed()) return;
      }
      if (!hostAlive()) return;
      prevented = false;
      this.app.emit('will-quit', { preventDefault() { prevented = true; } });
      if (!hostAlive() || prevented) return;
      this.host.close();
      // A successful shutdown sets host.dead; only unexpected invalidation
      // (not that normal close flag) can prevent the final quit event.
      if (this.terminated) return;
      checked(this.core.dispatch(this.runtime, 'stop'));
      this.terminated = true;
      this.releaseSingleInstanceLock();
      // Native shutdown already happened; the final quit event is informational
      // and cannot prevent the exit, though Electron passes an Event object.
      this.app.emit('quit', { preventDefault() {} }, 0);
    } finally {
      if (begunQuit && !this.terminated) {
        if (this.host.dead) {
          this.invalidateHost();
        } else {
          try { checked(this.core.dispatch(this.runtime, 'cancel-quit')); }
          catch (error) { this.invalidateHost(error); }
        }
      }
      this.quitting = false;
    }
  }
  invalidateWindows() {
    // Host loss is not a normal close acknowledgment; do not forge the
    // public "closed" event for a window that may have crashed.
    for (const window of this.windows.values()) window._destroyed = true;
    this.windows.clear();
  }
  invalidateHost(cause) {
    if (this.terminated) return;
    this.terminated = true;
    this.releaseSingleInstanceLock();
    const wasReady = this.ready;
    this.ready = false;
    this.host.abort();
    this.core.dispatch(this.runtime, 'stop');
    this.invalidateWindows();
    if (!wasReady && this.rejectReady) {
      this.rejectReady(cause || runtimeError('ELECTRON_MBT_TRANSPORT_CLOSED',
        'Native host terminated before app ready'));
    }
    this.app.emit('runtime-host-gone', cause);
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
