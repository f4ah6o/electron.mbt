'use strict';
const { types } = require('node:util');
const { encodeTiny } = require('./clone.cjs');
const { runtimeError } = require('./errors.cjs');
const NativePromise = Promise;
const registries = new WeakMap();

function fail(code) { throw runtimeError('ELECTRON_MBT_' + code, 'Context bridge registry rejected operation'); }
function copy(value) { return value === undefined ? undefined : JSON.parse(encodeTiny(value)); }
function authority(value) {
  const result = copy(value);
  if (!result || typeof result !== 'object' || Array.isArray(result) ||
      Object.keys(result).sort().join(',') !== 'channel,generation,mainFrame,origin,window') {
    fail('InvalidPayload');
  }
  return Object.freeze(result);
}
function identifier(id) {
  if (!Number.isSafeInteger(id) || id <= 0) fail('InvalidPayload');
  return String(id);
}
function checked(raw) {
  const result = JSON.parse(raw);
  if (result.ok !== true) fail(result.code || 'InvalidPayload');
  return result;
}

class ContextBridgeRegistry {
  #core; #runtime; #entries = new Map();
  constructor(core, runtime) { this.#core = core; this.#runtime = runtime; }
  #command(op, scope, kind, id) {
    const request = { op, ...scope, kind };
    if (id !== undefined) request.id = identifier(id);
    return checked(this.#core.context_bridge_dispatch(this.#runtime, JSON.stringify(request)));
  }
  #drop(id) {
    const entry = this.#entries.get(id);
    this.#entries.delete(id);
    return entry;
  }
  #reject(entry) {
    if (entry?.reject) entry.reject(runtimeError('ELECTRON_MBT_BRIDGE_REVOKED', 'Bridge handle was released or its document was revoked'));
  }
  reconcile() {
    const removed = [];
    for (const id of this.#entries.keys()) {
      if (!this.#core.context_bridge_retained(this.#runtime, id)) removed.push(this.#drop(id));
    }
    // Clearing all strong references first prevents partial cleanup on reentry.
    for (const entry of removed) this.#reject(entry);
    return removed.length;
  }
  get retainedCount() { this.reconcile(); return this.#entries.size; }
  retainFunction(scope, fn, kind = 'function') {
    this.reconcile();
    if (typeof fn !== 'function' || types.isProxy(fn) || !['function', 'callback'].includes(kind)) fail('InvalidPayload');
    const frozen = authority(scope);
    const { id } = this.#command('register', frozen, kind);
    this.#entries.set(id, { fn, kind });
    return id;
  }
  invoke(scope, id, args = [], kind = 'function') {
    this.reconcile();
    const frozen = authority(scope);
    this.#command('validate', frozen, kind, id);
    const entry = this.#entries.get(id);
    if (!entry?.fn || entry.kind !== kind) fail('UnknownBridgeHandle');
    if (!Array.isArray(args)) fail('InvalidPayload');
    const input = copy(args);
    let output;
    try { output = Reflect.apply(entry.fn, undefined, input); }
    catch (error) {
      this.reconcile();
      this.#command('validate', frozen, kind, id);
      throw error;
    }
    this.reconcile();
    this.#command('validate', frozen, kind, id);
    // A Promise or function return is not silently turned into a JSON value.
    return copy(output);
  }
  createPromise(scope) {
    this.reconcile();
    const frozen = authority(scope);
    const { id } = this.#command('register', frozen, 'promise');
    let resolve, reject;
    const promise = new NativePromise((yes, no) => { resolve = yes; reject = no; });
    // Revocation can precede caller subscription; the returned promise still rejects.
    promise.catch(() => {});
    this.#entries.set(id, { kind: 'promise', resolve, reject });
    return Object.freeze({ id, promise });
  }
  settlePromise(scope, id, fulfilled, value) {
    this.reconcile();
    const frozen = authority(scope);
    if (typeof fulfilled !== 'boolean') fail('InvalidPayload');
    this.#command('validate', frozen, 'promise', id);
    const entry = this.#entries.get(id);
    if (entry?.kind !== 'promise') fail('UnknownBridgeHandle');
    // Getters, proxy traps and callable thenables must not run after consumption.
    const output = copy(value);
    this.#command('settle', frozen, 'promise', id);
    this.#drop(id);
    if (fulfilled) entry.resolve(output); else entry.reject(output);
  }
  release(scope, id, kind) {
    this.reconcile();
    const frozen = authority(scope);
    const result = this.#command('release', frozen, kind, id);
    this.#reject(this.#drop(id));
    return result.released;
  }
}

class ContextExposureRegistry {
  #core; #runtime;
  constructor(core, runtime) { this.#core = core; this.#runtime = runtime; }
  // B6-B metadata only: the descriptor body and JS functions stay in the
  // WebView realm. MoonBit owns the key/hash/quota/lifetime authority.
  expose(scope, apiKey, descriptorBytes, functionCount, descriptorSha256) {
    const frozen = authority(scope);
    if (typeof apiKey !== 'string' || apiKey.length === 0 || apiKey.length > 64 ||
        !Number.isSafeInteger(descriptorBytes) || descriptorBytes < 1 ||
        descriptorBytes > 65536 || !Number.isSafeInteger(functionCount) ||
        functionCount < 0 || functionCount > 256 ||
        typeof descriptorSha256 !== 'string' || !/^[0-9a-f]{64}$/.test(descriptorSha256)) {
      fail('InvalidPayload');
    }
    const result = checked(this.#core.context_bridge_dispatch(this.#runtime, JSON.stringify({
      op: 'expose', ...frozen, apiKey, descriptorBytes, functionCount, descriptorSha256,
    })));
    return Object.freeze({ id: result.id, apiKey });
  }
}

function bindContextBridgeCore(core) {
  const bound = { ...core };
  const exposureRegistries = new WeakMap();
  bound.context_registry = runtime => {
    let registry = registries.get(runtime);
    if (!registry) { registry = new ContextBridgeRegistry(core, runtime); registries.set(runtime, registry); }
    return registry;
  };
  bound.context_exposures = runtime => {
    let registry = exposureRegistries.get(runtime);
    if (!registry) {
      registry = new ContextExposureRegistry(core, runtime);
      exposureRegistries.set(runtime, registry);
    }
    return registry;
  };
  for (const operation of ['dispatch', 'window_navigate', 'window_invalidate', 'window_destroy']) {
    bound[operation] = (...args) => {
      try { return core[operation](...args); }
      finally { registries.get(args[0])?.reconcile(); }
    };
  }
  return Object.freeze(bound);
}
module.exports = { bindContextBridgeCore };
