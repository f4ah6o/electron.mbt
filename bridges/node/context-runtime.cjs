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
      this.contextExposures = this.core.context_exposures(this.runtime);
      this.host.on('preload-exposure', details => this.#registerPreloadExposure(details));
      this.ipc = createIpcMain(this.core, this.runtime, name => {
        throw runtimeError('ELECTRON_MBT_UNSUPPORTED_API',
          `${name} is not available in the experimental M1 profile`);
      });
      this.ipcMain = this.ipc.ipcMain;
      this.menuState = createMenu();
      this.menu = this.menuState.menu;
    } catch (error) { this.abort(); throw error; }
  }

  #registerPreloadExposure(details) {
    const payload = details?.payload;
    if (!payload || typeof payload !== 'object' || Array.isArray(payload) ||
        typeof payload.apiKey !== 'string' || payload.apiKey.length === 0 ||
        payload.apiKey.length > 64 || !Number.isSafeInteger(payload.descriptorBytes) ||
        payload.descriptorBytes < 1 || payload.descriptorBytes > 65536 ||
        !Number.isSafeInteger(payload.functionCount) || payload.functionCount < 0 ||
        payload.functionCount > 256 || typeof payload.descriptorSHA256 !== 'string' ||
        !/^[0-9a-f]{64}$/.test(payload.descriptorSHA256)) {
      // A native-attested event with a malformed authority payload is a
      // protocol failure, not a preload success.
      this.abort();
      return;
    }
    const attempt = count => {
      if (this.terminated) return;
      const target = this.windows.get(details.window);
      if (!target) {
        if (count < 100) setTimeout(() => attempt(count + 1), 20);
        return;
      }
      if (details.generation !== target._generation) return;
      if (target._loading) {
        // The native load may have completed before the Node load Promise
        // settles; do not treat this as a failed exposure.
        if (count < 100) setTimeout(() => attempt(count + 1), 20);
        return;
      }
      try {
        const scope = this.bootstrapScopeForTrustedHost(target, 'preload-read');
        this.contextExposures.expose(scope, payload.apiKey, payload.descriptorBytes,
          payload.functionCount, payload.descriptorSHA256);
      } catch (error) {
        if (error?.code === 'ELECTRON_MBT_BRIDGE_NOT_READY' && count < 100) {
          setTimeout(() => attempt(count + 1), 20);
        } else {
          this.abort();
        }
      }
    };
    attempt(0);
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
