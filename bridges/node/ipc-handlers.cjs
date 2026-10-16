'use strict';
const { types } = require('node:util');
const { encodeTiny } = require('./clone.cjs');
const { encodeInvoke, decodeInvoke, cloneInvoke } = require('./invoke-codec.cjs');
const { runtimeError } = require('./errors.cjs');

function createInvokeHandlers(core, runtime) {
  const registry = core.new_invokes(runtime);
  const handlers = new Map();
  const pending = new Map();
  let disposed = false;

  function result(operation) {
    return JSON.parse(core.dispatch_invokes(registry, JSON.stringify(operation)));
  }
  function failure(value) {
    return runtimeError(`ELECTRON_MBT_CORE_${value.code}`, `Invocation rejected (${value.code})`);
  }
  function command(operation) {
    if (disposed) throw failure({ code: 'InvalidState' });
    const value = result(operation);
    if (value.ok !== true) throw failure(value);
    return value;
  }
  function channelArgument(channel) {
    if (typeof channel !== 'string' || !channel.isWellFormed()) {
      throw runtimeError('ELECTRON_MBT_INVALID_ARGUMENT', 'Invoke channel must be a well-formed string');
    }
  }
  function register(channel, listener, once) {
    channelArgument(channel);
    if (disposed) throw failure({ code: 'InvalidState' });
    const value = result({ op: 'register', channel, once, callable: typeof listener === 'function' });
    if (!value.ok) {
      if (value.code === 'DuplicateHandler') {
        throw runtimeError('ELECTRON_MBT_DUPLICATE_HANDLER', `Attempted to register a second handler for '${channel}'`);
      }
      if (value.code === 'InvalidPayload' && typeof listener !== 'function') {
        throw new TypeError(`Expected handler to be a function, but found type '${typeof listener}'`);
      }
      throw failure(value);
    }
    handlers.set(value.handler, listener);
  }
  const methods = {
    handle(channel, listener) { register(channel, listener, false); },
    handleOnce(channel, listener) { register(channel, listener, true); },
    removeHandler(channel) {
      channelArgument(channel);
      const value = command({ op: 'remove', channel });
      handlers.delete(value.handler);
    },
  };

  function handlerError(error) {
    // Accessors, proxies, toString and arbitrary error properties must not be
    // executed or forwarded while constructing a reply for another realm.
    let message = 'Handler failed';
    if (typeof error === 'string') message = error;
    else if (error !== null && typeof error === 'object' && !types.isProxy(error)) {
      const descriptor = Object.getOwnPropertyDescriptor(error, 'message');
      if (descriptor && typeof descriptor.value === 'string') message = descriptor.value;
    }
    return runtimeError('ELECTRON_MBT_HANDLER_ERROR', message.slice(0, 1024));
  }

  function settle(request, ok, value) {
    const entry = pending.get(request);
    if (!entry) return;
    let output, error;
    // A revoked document must not traverse or serialize a late result. This
    // also prevents the late result's own value error from hiding cancellation.
    try { command({ op: 'check', request }); } catch (cause) { error = cause; }
    if (!error) {
      if (ok) {
        try { output = cloneInvoke(value); } catch (cause) { error = cause; }
      } else error = handlerError(value);
    }
    try { command({ op: 'finish', request }); } catch (cause) { error = cause; }
    pending.delete(request);
    if (error) entry.reject(error);
    else entry.resolve(output);
  }

  function invoke(hostSender, channel, args, event) {
    let ticket, listener, copiedArgs;
    try {
      channelArgument(channel);
      const sender = JSON.parse(encodeTiny(hostSender));
      const wire = encodeInvoke(args);
      copiedArgs = decodeInvoke(wire);
      if (!Array.isArray(copiedArgs)) throw runtimeError('ELECTRON_MBT_INVALID_ARGUMENT', 'Invoke arguments must be an array');
      ticket = command({
        op: 'begin', window: sender.window, generation: sender.generation,
        host_origin: sender.host_origin, main_frame: sender.main_frame,
        channel, payload_bytes: Buffer.byteLength(wire, 'utf8'),
      });
      listener = handlers.get(ticket.handler);
      if (!listener) {
        command({ op: 'cancel', request: ticket.request });
        throw runtimeError('ELECTRON_MBT_HANDLER_INVARIANT', 'Core handler has no callable in this main realm');
      }
      if (ticket.once) handlers.delete(ticket.handler);
    } catch (error) { return Promise.reject(error); }
    const promise = new Promise((resolve, reject) => pending.set(ticket.request, { resolve, reject }));
    // A handler deadline is not a transport watchdog. A never-settling handler
    // retains a bounded ticket until native invalidation/reconcile or disposal.
    try {
      const value = Reflect.apply(listener, undefined, [event, ...copiedArgs]);
      Promise.resolve(value).then(
        output => settle(ticket.request, true, output),
        error => settle(ticket.request, false, error),
      );
    } catch (error) { settle(ticket.request, false, error); }
    return promise;
  }

  function reconcile() {
    for (const request of pending.keys()) {
      const state = result({ op: 'check', request });
      if (state.ok) continue;
      const entry = pending.get(request);
      result({ op: 'cancel', request });
      pending.delete(request);
      entry.reject(failure(state));
    }
  }
  function dispose() {
    if (disposed) return;
    result({ op: 'dispose' });
    disposed = true;
    handlers.clear();
    for (const entry of pending.values()) entry.reject(failure({ code: 'InvalidState' }));
    pending.clear();
  }
  // Only trusted host code receives this controller. The public ipcMain object
  // gets methods alone, not a sender-forging renderer entry point.
  return { methods, invoke, reconcile, dispose };
}

module.exports = { createInvokeHandlers };
