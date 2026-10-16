'use strict';
const { runtimeError } = require('./errors.cjs');

function createIpcMain(core, runtime, unsupported) {
  const callbacks = new Map();
  let disposed = false;
  let ipcMain;

  function command(operation) {
    if (disposed) throw runtimeError('ELECTRON_MBT_CORE_InvalidState', 'ipcMain belongs to a stopped runtime');
    const result = JSON.parse(core.dispatch(runtime, JSON.stringify(operation)));
    if (result.ok !== true) throw runtimeError(`ELECTRON_MBT_CORE_${result.code}`, `Core rejected ipcMain operation (${result.code})`);
    return result;
  }
  function channelArgument(channel) {
    if (typeof channel !== 'string' || !channel.isWellFormed()) {
      throw runtimeError('ELECTRON_MBT_INVALID_ARGUMENT', 'ipcMain channel must be a well-formed string');
    }
  }
  function listenerArgument(listener) {
    if (typeof listener !== 'function') throw runtimeError('ELECTRON_MBT_INVALID_ARGUMENT', 'ipcMain listener must be a function');
  }
  function snapshot(channel) {
    channelArgument(channel);
    return command({ op: 'ipc.listeners.snapshot', channel }).listeners.map(id => {
      const entry = callbacks.get(id);
      if (!entry) throw runtimeError('ELECTRON_MBT_LISTENER_INVARIANT', 'Core listener has no callback in this main realm');
      return { id, ...entry };
    });
  }
  function removeId(id) {
    command({ op: 'ipc.listeners.remove', listener: id });
    callbacks.delete(id);
  }
  function add(channel, listener, once) {
    channelArgument(channel);
    listenerArgument(listener);
    const id = command({ op: 'ipc.listeners.add', channel }).listener;
    let raw = listener;
    if (once) {
      let fired = false;
      raw = function (...args) {
        // Detached emission snapshots still retain this wrapper. Removing an id
        // alone cannot prevent a nested emission from invoking it twice.
        if (fired) return;
        fired = true;
        removeId(id);
        return Reflect.apply(listener, ipcMain, args);
      };
      raw.listener = listener;
    }
    callbacks.set(id, { raw, listener });
    return ipcMain;
  }

  const methods = {
    on(channel, listener) { return add(channel, listener, false); },
    once(channel, listener) { return add(channel, listener, true); },
    removeListener(channel, listener) {
      listenerArgument(listener);
      const entries = snapshot(channel);
      for (let index = entries.length - 1; index >= 0; index--) {
        const entry = entries[index];
        if (entry.raw === listener || entry.listener === listener) {
          removeId(entry.id);
          break;
        }
      }
      return ipcMain;
    },
    removeAllListeners(channel) {
      if (channel !== undefined) channelArgument(channel);
      const operation = channel === undefined
        ? { op: 'ipc.listeners.clear-all' }
        : { op: 'ipc.listeners.clear-channel', channel };
      const result = command(operation);
      for (const id of result.listeners) callbacks.delete(id);
      return ipcMain;
    },
    listeners(channel) { return snapshot(channel).map(entry => entry.listener); },
    rawListeners(channel) { return snapshot(channel).map(entry => entry.raw); },
    listenerCount(channel, listener) {
      const entries = snapshot(channel);
      if (listener === undefined) return entries.length;
      listenerArgument(listener);
      return entries.filter(entry => entry.listener === listener || entry.raw === listener).length;
    },
    emit(channel, ...args) {
      // This is main-local EventEmitter dispatch, not a renderer ingress. No
      // sender, frame, origin, grant or IPC authorization is synthesized here.
      const entries = snapshot(channel);
      for (const entry of entries) Reflect.apply(entry.raw, ipcMain, args);
      return entries.length !== 0;
    },
  };
  methods.addListener = methods.on;
  methods.off = methods.removeListener;
  ipcMain = new Proxy(methods, {
    get(target, property, receiver) {
      if (Object.hasOwn(target, property)) return Reflect.get(target, property, receiver);
      if (typeof property === 'symbol' || property === 'then') return undefined;
      return unsupported(`ipcMain.${String(property)}`);
    },
  });
  return {
    ipcMain,
    dispose() { disposed = true; callbacks.clear(); },
  };
}

module.exports = { createIpcMain };
