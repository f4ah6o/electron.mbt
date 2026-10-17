'use strict';
(function () {
  const sources = globalThis.__nativeSources;
  const entry = globalThis.__nativeMainId;
  const appRoot = globalThis.__nativeAppRoot || '/moji';
  const windows = [];
  const ipcHandlers = Object.create(null);
  const appListeners = Object.create(null);
  const state = { whenReady: false, error: null, main: null };

  function makeError(code, message) {
    const error = new Error(message);
    error.code = code;
    return error;
  }
  function decodeBase64(text) {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    const clean = String(text).replace(/[^A-Za-z0-9+/=]/g, '');
    const out = [];
    let bits = 0;
    let value = 0;
    for (let index = 0; index < clean.length; index += 1) {
      const character = clean[index];
      if (character === '=') break;
      const digit = alphabet.indexOf(character);
      if (digit < 0) continue;
      value = (value << 6) | digit;
      bits += 6;
      if (bits >= 8) {
        bits -= 8;
        out.push((value >> bits) & 255);
      }
    }
    return out;
  }
  function decorate(bytes) {
    bytes.equals = function (other) {
      if (!other || other.length !== this.length) return false;
      for (let index = 0; index < this.length; index += 1) {
        if (this[index] !== other[index]) return false;
      }
      return true;
    };
    bytes.toString = function (encoding) {
      if (encoding === 'base64') {
        let out = '';
        for (let index = 0; index < this.length; index += 1) {
          out += String.fromCharCode(this[index]);
        }
        return btoa(out);
      }
      let text = '';
      for (let index = 0; index < this.length; index += 1) text += String.fromCharCode(this[index]);
      return text;
    };
    return bytes;
  }
  const Buffer = {
    from: function (input, encoding) {
      if (typeof input === 'string') {
        if (encoding === 'base64') return decorate(Uint8Array.from(decodeBase64(input)));
        const bytes = [];
        for (let index = 0; index < input.length; index += 1) {
          const code = input.charCodeAt(index);
          if (code < 128) bytes.push(code);
          else if (code < 2048) bytes.push(192 | (code >> 6), 128 | (code & 63));
          else bytes.push(224 | (code >> 12), 128 | ((code >> 6) & 63), 128 | (code & 63));
        }
        return decorate(Uint8Array.from(bytes));
      }
      return decorate(Uint8Array.from(input));
    },
    alloc: function (size) { return decorate(new Uint8Array(size)); },
    allocUnsafe: function (size) { return decorate(new Uint8Array(size)); },
    concat: function (parts) {
      let total = 0;
      for (const part of parts) total += part.length;
      const out = decorate(new Uint8Array(total));
      let offset = 0;
      for (const part of parts) {
        out.set(part, offset);
        offset += part.length;
      }
      return out;
    },
  };

  const app = {
    name: 'Moji',
    isPackaged: false,
    getVersion: function () { return '1.0.5'; },
    getLocale: function () { return 'en'; },
    getPath: function (name) {
      if (name === 'userData') return '/tmp/electron-mbt-moji-boot/userData';
      if (name === 'appData') return '/tmp/electron-mbt-moji-boot/appData';
      return '/tmp/electron-mbt-moji-boot';
    },
    setPath: function () {},
    getAppPath: function () { return appRoot; },
    requestSingleInstanceLock: function () { return true; },
    whenReady: function () {
      state.whenReady = true;
      return Promise.resolve();
    },
    on: function (name, callback) {
      (appListeners[name] = appListeners[name] || []).push(callback);
      return app;
    },
    quit: function () {},
    setName: function () {},
    setDesktopName: function () {},
  };

  function BrowserWindow(options) {
    this.options = options || {};
    this.webContents = {
      on: function () {},
      once: function () {},
      setWindowOpenHandler: function () {},
      printToPDF: function () { return Promise.resolve(Buffer.alloc(0)); },
    };
    windows.push(this);
  }
  BrowserWindow.prototype.on = function () { return this; };
  BrowserWindow.prototype.once = function () { return this; };
  BrowserWindow.prototype.loadURL = function () { return Promise.resolve(); };
  BrowserWindow.prototype.loadFile = function () { return Promise.resolve(); };
  BrowserWindow.prototype.show = function () {};
  BrowserWindow.prototype.setMenuBarVisibility = function () {};
  BrowserWindow.prototype.isMinimized = function () { return false; };
  BrowserWindow.prototype.restore = function () {};
  BrowserWindow.prototype.focus = function () {};
  BrowserWindow.prototype.destroy = function () {};
  BrowserWindow.getAllWindows = function () { return windows.slice(); };

  const ipcMain = {
    handle: function (channel, handler) { ipcHandlers[channel] = handler; },
    on: function () {},
  };
  const dialog = {
    showOpenDialog: function () { return Promise.resolve({ canceled: true, filePaths: [] }); },
    showSaveDialog: function () { return Promise.resolve({ canceled: true }); },
  };
  const Menu = {
    buildFromTemplate: function (template) { return { template: template }; },
    setApplicationMenu: function () {},
  };
  const screen = {
    getPrimaryDisplay: function () {
      return { scaleFactor: 2, workAreaSize: { width: 1280, height: 800 } };
    },
    getAllDisplays: function () { return []; },
  };
  const shell = {
    openPath: function () { return Promise.resolve(''); },
    openExternal: function () { return Promise.resolve(); },
  };
  const electron = {
    app: app,
    BrowserWindow: BrowserWindow,
    ipcMain: ipcMain,
    dialog: dialog,
    Menu: Menu,
    screen: screen,
    shell: shell,
  };

  const pathBuiltin = {
    join: function () {
      const absolute = arguments.length > 0 && typeof arguments[0] === 'string' &&
        arguments[0].startsWith('/');
      const parts = [];
      for (const argument of arguments) {
        if (typeof argument !== 'string') throw makeError('ELECTRON_MBT_BAD_PATH', 'path.join');
        for (const part of argument.split('/')) {
          if (!part || part === '.') continue;
          if (part === '..') { if (parts.length) parts.pop(); }
          else parts.push(part);
        }
      }
      return (absolute ? '/' : '') + parts.join('/');
    },
    basename: function (value) {
      const parts = String(value).split('/');
      return parts[parts.length - 1] || '';
    },
    dirname: function (value) {
      const parts = String(value).split('/');
      parts.pop();
      return parts.join('/') || '.';
    },
    extname: function (value) {
      const base = String(value).split('/').pop();
      const dot = base.lastIndexOf('.');
      return dot > 0 ? base.slice(dot) : '';
    },
  };
  const urlBuiltin = {
    fileURLToPath: function (value) {
      return decodeURIComponent(String(value).replace(/^file:\/\//, ''));
    },
    pathToFileURL: function (value) { return 'file://' + value; },
  };
  const fsBuiltin = {
    existsSync: function () { return false; },
    readFileSync: function () { throw makeError('ENOENT', 'moji boot fs is virtual'); },
    writeFileSync: function () {},
  };
  const fsPromises = {
    readFile: function (filePath) {
      if (String(filePath).endsWith('/samples/markdown-guide.en.md')) {
        return Promise.resolve('# Markdown Guide\n');
      }
      return Promise.reject(makeError('ENOENT', 'moji boot fs is virtual'));
    },
    writeFile: function () { return Promise.resolve(); },
  };
  const zlibBuiltin = {
    createDeflate: function () {
      return { on: function () {}, once: function () {}, write: function () { return true; }, end: function () {} };
    },
  };
  const updater = {
    autoUpdater: {
      allowPrerelease: false,
      on: function () {},
      checkForUpdates: function () { return Promise.resolve({}); },
      downloadUpdate: function () { return Promise.resolve(); },
      quitAndInstall: function () {},
    },
  };
  const processShim = {
    platform: 'darwin',
    argv: [],
    env: {},
    resourcesPath: appRoot,
    cwd: function () { return appRoot; },
    versions: { node: '22.0.0' },
    nextTick: function (callback) { Promise.resolve().then(callback); },
  };
  const builtins = {
    'electron': electron,
    'electron-updater': updater,
    'node:path': pathBuiltin,
    'path': pathBuiltin,
    'node:url': urlBuiltin,
    'url': urlBuiltin,
    'node:fs': fsBuiltin,
    'fs': fsBuiltin,
    'node:fs/promises': fsPromises,
    'fs/promises': fsPromises,
    'node:zlib': zlibBuiltin,
    'zlib': zlibBuiltin,
    'process': processShim,
  };

  const cache = Object.create(null);
  function normalize(from, spec) {
    if (typeof spec !== 'string' || !spec.startsWith('.') || spec.includes(String.fromCharCode(92))) {
      throw makeError('ELECTRON_MBT_BAD_REQUIRE', 'bad require');
    }
    const base = from.includes('/') ? from.slice(0, from.lastIndexOf('/')) : '';
    const parts = (base + '/' + spec).split('/');
    const out = [];
    for (const part of parts) {
      if (!part || part === '.') continue;
      if (part === '..') {
        if (!out.length) throw makeError('ELECTRON_MBT_REQUIRE_ESCAPE', 'require escape');
        out.pop();
      } else out.push(part);
    }
    return out.join('/');
  }
  function tryId(target) {
    const candidates = [target, target + '.js', target + '.cjs', target + '.json', target + '/index.js'];
    for (const candidate of candidates) {
      if (sources[candidate] !== undefined) return candidate;
    }
    return null;
  }
  function resolveBare(spec) {
    const parts = spec.split('/');
    const name = spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
    const rest = spec.startsWith('@') ? parts.slice(2) : parts.slice(1);
    const subpath = rest.length === 0 ? '.' : './' + rest.join('/');
    const metaId = 'node_modules/' + name + '/package.json';
    if (sources[metaId] === undefined) return null;
    const meta = JSON.parse(sources[metaId]);
    let target = meta.main || 'index.js';
    if (subpath !== '.') target = subpath;
    return 'node_modules/' + name + '/' + target.replace(/^\.\//, '');
  }
  function load(id, parent) {
    if (Object.prototype.hasOwnProperty.call(builtins, id)) return builtins[id];
    if (id.startsWith('node:') || ['fs', 'url', 'util', 'events', 'process', 'buffer', 'os', 'crypto', 'http', 'https', 'net', 'stream'].includes(id)) {
      throw makeError('ELECTRON_MBT_UNSUPPORTED_BUILTIN', 'unsupported builtin: ' + id);
    }
    let target;
    if ((parent || '') === '' && sources[id] !== undefined) target = id;
    else if (id.startsWith('.')) target = normalize(parent || '', id);
    else target = resolveBare(id);
    const resolved = target === null ? null : tryId(target);
    if (resolved === null) throw makeError('ELECTRON_MBT_MODULE_NOT_FOUND', 'module not found: ' + id);
    if (cache[resolved]) return cache[resolved].exports;
    if (resolved.endsWith('.json')) return JSON.parse(sources[resolved]);
    const module = { exports: {} };
    cache[resolved] = module;
    const dirname = resolved.includes('/') ? resolved.slice(0, resolved.lastIndexOf('/')) : '';
    const fn = new Function('require', 'module', 'exports', '__dirname', '__filename', 'process', 'Buffer', 'global',
      sources[resolved] + '\n//# sourceURL=' + resolved);
    fn(function (spec) { return load(spec, resolved); }, module, module.exports,
      dirname, resolved, processShim, Buffer, globalThis);
    return module.exports;
  }

  globalThis.__mojiBoot = function () {
    try {
      state.main = load(entry, '');
      globalThis.__nativeMain = state.main;
    } catch (error) {
      state.error = error;
    }
  };
  globalThis.__mojiInstallInvoke = function () {
    globalThis.__nativeInvoke = function (operation, payloadJson) {
      let payload = {};
      try { payload = payloadJson ? JSON.parse(payloadJson) : {}; } catch (_) { payload = {}; }
      const handler = ipcHandlers[operation];
      if (typeof handler !== 'function') {
        return JSON.stringify({ ok: false, code: 'ELECTRON_MBT_MAIN_UNKNOWN_OPERATION' });
      }
      try {
        const args = Array.isArray(payload.args) ? payload.args : [];
        const value = handler({}, ...args);
        if (value && typeof value.then === 'function') {
          return JSON.stringify({ ok: false, code: 'ELECTRON_MBT_MAIN_ASYNC_PENDING' });
        }
        return JSON.stringify({ ok: true, result: value === undefined ? null : value });
      } catch (error) {
        return JSON.stringify({ ok: false, code: 'ELECTRON_MBT_MAIN_ERROR' });
      }
    };
  };

  globalThis.__mojiBootFinish = function () {
    const results = {};
    const pending = [];
    function call(key, operation, args) {
      const handler = ipcHandlers[operation];
      if (typeof handler !== 'function') {
        results[key] = { missing: true };
        return;
      }
      try {
        const value = handler({}, ...(args || []));
        if (value && typeof value.then === 'function') {
          pending.push(value.then(function (resolved) {
            results[key] = resolved === undefined ? { ok: true } : resolved;
          }).catch(function (error) {
            results[key] = { error: String(error && error.message || error) };
          }));
        } else {
          results[key] = value === undefined ? { ok: true } : value;
        }
      } catch (error) {
        results[key] = { error: String(error && error.message || error) };
      }
    }
    call('settingsBefore', 'settings:get', []);
    call('settingsSet', 'settings:set', [{ previewTheme: 'light' }]);
    call('settingsAfter', 'settings:get', []);
    call('updateState', 'update:get-state', []);
    call('confirmClose', 'app:confirm-close', [false]);
    call('readSample', 'file:read-sample', ['markdown-guide.en.md']);
    return Promise.all(pending).then(function () {
      const handlersOk = state.error === null &&
        results.settingsBefore && results.settingsBefore.previewTheme === 'dark' &&
        results.settingsSet && results.settingsSet.previewTheme === 'light' &&
        results.settingsAfter && results.settingsAfter.previewTheme === 'light' &&
        results.updateState && results.updateState.status === 'unsupported' &&
        results.confirmClose && results.confirmClose.ok === true &&
        results.readSample && results.readSample.ok === true;
      const report = {
        status: state.error === null && state.whenReady && windows.length > 0 &&
          Object.keys(ipcHandlers).length === 14 && handlersOk ? 'PASS' : 'FAIL',
        probe: 'moji-main-boot',
        app: 'moji-v1.0.5',
        entry: entry,
        mainEvaluated: state.error === null,
        whenReady: state.whenReady,
        windows: windows.length,
        ipcHandlers: Object.keys(ipcHandlers).length,
        preloadPresent: typeof sources['out/preload/preload.js'] === 'string',
        preloadExecuted: false,
        handlerResults: results,
        error: state.error === null ? null : String(state.error && state.error.message || state.error),
        compatible: false,
      };
      globalThis.__nativeBootReport = JSON.stringify(report);
    });
  };
})();
