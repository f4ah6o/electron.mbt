'use strict';
// Runtime-owned leaf resolved for require('electron') by installElectronFacade.
// App lifecycle and bounded main-local listeners use the compiled MoonBit core.
// Unimplemented Electron surfaces fail closed. Main-local emit is not renderer
// IPC or evidence of BrowserWindow, contextBridge or Electron compatibility.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { runtimeError } = require('./errors.cjs');
const { createIpcMain } = require('./ipc-main.cjs');

const CONTEXT_LIMIT = 65536;
// Issue 0001 section 11: the default userData must be an independent directory
// and must never reuse a same-named real Electron app's <appData>/<name>, so
// the runtime namespaces it. A launcher can still override via context.userData
// or app.setPath.
const USERDATA_NAMESPACE = 'electron.mbt';

function loadCore() {
  try {
    return require('../../dist/core.cjs');
  } catch {
    throw runtimeError('ELECTRON_MBT_NOT_BUILT', 'Build the MoonBit boundary with node scripts/build-core.cjs.');
  }
}

function readContext() {
  const raw = process.env.ELECTRON_MBT_FACADE_CONTEXT;
  if (typeof raw !== 'string' || raw.length === 0) {
    throw runtimeError('ELECTRON_MBT_NOT_LAUNCHED', 'require(\'electron\') is only available to an app launched by electron-mbt');
  }
  if (raw.length > CONTEXT_LIMIT) {
    throw runtimeError('ELECTRON_MBT_INVALID_METADATA', 'Launch context exceeds its size limit');
  }
  let value;
  try { value = JSON.parse(raw); } catch {
    throw runtimeError('ELECTRON_MBT_INVALID_METADATA', 'Launch context is not valid JSON');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw runtimeError('ELECTRON_MBT_INVALID_METADATA', 'Launch context must be an object');
  }
  for (const key of ['root', 'name', 'version']) {
    if (typeof value[key] !== 'string' || value[key].length === 0) {
      throw runtimeError('ELECTRON_MBT_INVALID_METADATA', `Launch context requires a non-empty ${key}`);
    }
  }
  if (!path.isAbsolute(value.root)) {
    throw runtimeError('ELECTRON_MBT_INVALID_METADATA', 'Launch context root must be absolute');
  }
  if (value.userData !== undefined && (typeof value.userData !== 'string' || !path.isAbsolute(value.userData))) {
    throw runtimeError('ELECTRON_MBT_INVALID_METADATA', 'Launch context userData must be an absolute path');
  }
  return value;
}

const core = loadCore();
const context = readContext();
const runtime = core.new_runtime();

function call(operation) {
  const result = JSON.parse(core.dispatch(runtime, typeof operation === 'string' ? operation : JSON.stringify(operation)));
  if (!result.ok) {
    throw runtimeError(`ELECTRON_MBT_CORE_${result.code}`, `Core rejected the lifecycle operation (${result.code})`);
  }
  if (operation === 'stop') ipc.dispose();
  return result;
}
function appState() {
  return JSON.parse(core.dispatch(runtime, 'state')).state;
}

function unsupported(name) {
  // A regular function keeps [[Construct]] so `new` reaches the construct
  // trap; an arrow function would fail with an untyped "not a constructor".
  const fail = function () {
    throw runtimeError('ELECTRON_MBT_UNSUPPORTED_API', `${name} is not implemented by electron-mbt; the M0 profile does not cover it`);
  };
  return new Proxy(fail, {
    get(target, property) {
      if (property === 'name') return name;
      if (typeof property === 'symbol' || ['apply', 'bind', 'call', 'prototype', 'length', 'arguments', 'caller', 'then', 'inspect', 'toString', 'valueOf'].includes(property)) {
        return target[property];
      }
      return unsupported(`${name}.${String(property)}`);
    },
    construct() {
      throw runtimeError('ELECTRON_MBT_UNSUPPORTED_API', `${name} is not implemented by electron-mbt; the M0 profile does not cover it`);
    },
  });
}

const ipc = createIpcMain(core, runtime, unsupported);
const app = new EventEmitter();
const pathOverrides = new Map();
if (context.userData) pathOverrides.set('userData', context.userData);

function appDataDir() {
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support');
  if (process.platform === 'win32') return process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  return process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
}

app.isReady = () => ['Ready', 'Quitting'].includes(appState());
// Electron delivers (event, launchInfo) for 'ready'; launchInfo is {} off macOS.
app.whenReady = () => (app.isReady() ? Promise.resolve({}) : new Promise(resolve => app.once('ready', (event, launchInfo) => resolve(launchInfo))));
app.getName = () => context.name;
app.setName = name => {
  if (typeof name !== 'string' || name.length === 0) throw runtimeError('ELECTRON_MBT_INVALID_ARGUMENT', 'setName requires a non-empty string');
  context.name = name;
};
app.getVersion = () => context.version;
app.getAppPath = () => context.root;
app.isPackaged = () => false;
app.getPath = name => {
  if (pathOverrides.has(name)) return pathOverrides.get(name);
  switch (name) {
    case 'home': return os.homedir();
    case 'temp': return os.tmpdir();
    case 'desktop': return path.join(os.homedir(), 'Desktop');
    case 'documents': return path.join(os.homedir(), 'Documents');
    case 'downloads': return path.join(os.homedir(), 'Downloads');
    case 'appData': return appDataDir();
    case 'userData': return path.join(appDataDir(), USERDATA_NAMESPACE, app.getName());
    default: throw runtimeError('ELECTRON_MBT_INVALID_ARGUMENT', `Failed to get '${name}' path`);
  }
};
app.setPath = (name, directory) => {
  if (name !== 'userData') throw runtimeError('ELECTRON_MBT_UNSUPPORTED_API', `setPath('${name}') is outside the declared path profile`);
  if (typeof directory !== 'string' || directory.length === 0 || !path.isAbsolute(directory)) {
    throw runtimeError('ELECTRON_MBT_INVALID_ARGUMENT', 'setPath requires an absolute path string');
  }
  // Electron's setPath throws when the target does not exist or is not a
  // directory; the declared subset keeps that synchronous failure contract.
  let stat;
  try { stat = fs.statSync(directory); } catch { stat = null; }
  if (!stat || !stat.isDirectory()) {
    throw runtimeError('ELECTRON_MBT_INVALID_ARGUMENT', `setPath('${name}') requires an existing directory`);
  }
  pathOverrides.set(name, directory);
};
app.quit = () => {
  if (appState() === 'Quitting' || appState() === 'Stopped') return;
  if (appState() === 'Ready') {
    call('begin-quit');
    let prevented = false;
    app.emit('before-quit', { preventDefault: () => { prevented = true; } });
    if (prevented) { call('cancel-quit'); return; }
    app.emit('will-quit', { preventDefault: () => { prevented = true; } });
    if (prevented) { call('cancel-quit'); return; }
  }
  // Electron emits 'quit' with (event, exitCode); the event is not
  // preventDefault-able at this point because quitting is already committed.
  app.emit('quit', { preventDefault: () => {} }, 0);
  call('stop');
  process.exit(0);
};
app.exit = (code = 0) => {
  if (!Number.isInteger(code)) throw runtimeError('ELECTRON_MBT_INVALID_ARGUMENT', 'exit requires an integer code');
  // Electron does not emit quit lifecycle events for exit(); the core still
  // records the terminal transition.
  call('stop');
  process.exit(code);
};

// The production host drives ready through the control channel; this leaf has
// no host, so readiness transitions on the first macrotask after main module
// evaluation, matching the observable contract that isReady() is false during
// synchronous main evaluation. A quit before that point prevents 'ready'.
setImmediate(() => {
  try {
    if (appState() === 'Booting' && JSON.parse(core.dispatch(runtime, 'ready')).ok) app.emit('ready', { preventDefault: () => {} }, {});
  } catch { /* a stopped runtime never becomes ready */ }
});

module.exports = {
  app,
  BrowserWindow: unsupported('BrowserWindow'),
  ipcMain: ipc.ipcMain,
  ipcRenderer: unsupported('ipcRenderer'),
  contextBridge: unsupported('contextBridge'),
  dialog: unsupported('dialog'),
  shell: unsupported('shell'),
  clipboard: unsupported('clipboard'),
  Menu: unsupported('Menu'),
  MenuItem: unsupported('MenuItem'),
  Tray: unsupported('Tray'),
  Notification: unsupported('Notification'),
  nativeImage: unsupported('nativeImage'),
  net: unsupported('net'),
  protocol: unsupported('protocol'),
  session: unsupported('session'),
  screen: unsupported('screen'),
  systemPreferences: unsupported('systemPreferences'),
  powerMonitor: unsupported('powerMonitor'),
  autoUpdater: unsupported('autoUpdater'),
  webContents: unsupported('webContents'),
  webFrame: unsupported('webFrame'),
  safeStorage: unsupported('safeStorage'),
  TouchBar: unsupported('TouchBar'),
  globalShortcut: unsupported('globalShortcut'),
};
