'use strict';
const session = require('./runtime-session.cjs');
const { bindContextBridgeCore } = require('./context-bridge-registry.cjs');
const { createIpcMain } = require('./ipc-main.cjs');
const { createMenu } = require('./menu.cjs');
const { runtimeError } = require('./errors.cjs');

function checked(core, runtime, operation) {
  const reply = JSON.parse(core.context_bridge_dispatch(runtime, JSON.stringify(operation)));
  if (reply.ok !== true) {
    throw runtimeError('ELECTRON_MBT_' + (reply.code || 'InvalidPayload'),
      'MoonBit denied trusted bootstrap document authority');
  }
}

class ExperimentalRuntime extends session.ExperimentalRuntime {
  #activated = new WeakMap();
  constructor(appInfo, options = {}) {
    super(appInfo, options);
    try {
      this.core = bindContextBridgeCore(this.core);
      this.contextHandles = this.core.context_registry(this.runtime);
      this.ipc = createIpcMain(this.core, this.runtime, name => {
        throw runtimeError('ELECTRON_MBT_UNSUPPORTED_API',
          `${name} is not available in the experimental M1 profile`);
      });
      this.ipcMain = this.ipc.ipcMain;
      this.menuState = createMenu();
      this.menu = this.menuState.menu;
    } catch (error) { this.abort(); throw error; }
  }

  invalidateHost(cause) {
    try { this.ipc?.dispose(); this.menuState?.dispose(); } finally { super.invalidateHost(cause); }
  }

  quit() {
    try { super.quit(); } finally { if (this.terminated) { this.ipc?.dispose(); this.menuState?.dispose(); } }
  }

  bootstrapScopeForTrustedHost(window, channel) {
    if (typeof channel !== 'string' || channel.length < 1 ||
        channel.length > 128 || !channel.isWellFormed()) {
      throw runtimeError('ELECTRON_MBT_InvalidPayload', 'Invalid trusted bridge channel');
    }
    if (!window || this.windows.get(window.id) !== window || this.terminated ||
        window._destroyed || window._loading || window._renderProcessGone ||
        !Number.isSafeInteger(window._generation) || window._generation <= 0) {
      throw runtimeError('ELECTRON_MBT_BRIDGE_NOT_READY', 'No verified live WebKit document');
    }
    const native = this.host.request('get-bootstrap-status', window.id, window._generation);
    if (native.observed !== true || native.mainFrame !== true ||
        native.generation !== window._generation ||
        typeof native.documentURL !== 'string' ||
        !native.documentURL.startsWith('file://') ||
        native.documentURL !== window.webContents.getURL()) {
      throw runtimeError('ELECTRON_MBT_BRIDGE_NOT_READY', 'Native isolated-world bootstrap not observed');
    }
    const scope = Object.freeze({
      window: String(window.id), generation: String(native.generation),
      origin: native.documentURL, mainFrame: true, channel,
    });
    if (this.#activated.get(window) !== native.generation) {
      checked(this.core, this.runtime, {
        op: 'activate', window: scope.window,
        generation: scope.generation, origin: scope.origin,
      });
      this.#activated.set(window, native.generation);
    }
    checked(this.core, this.runtime, {
      op: 'grant', window: scope.window,
      generation: scope.generation, channel: scope.channel,
    });
    return scope;
  }
}
module.exports = { ...session, ExperimentalRuntime };
