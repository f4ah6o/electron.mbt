'use strict';
const { types } = require('node:util');
const { runtimeError } = require('./errors.cjs');
const { LIMITS } = require('./clone.cjs');

function unsupported() {
  throw runtimeError('ELECTRON_MBT_UNSUPPORTED_VALUE', 'Value is outside the invoke JSON/undefined profile');
}
function exceeded() {
  throw runtimeError('ELECTRON_MBT_LIMIT', 'Invoke value exceeds the profile limits');
}
function malformed() {
  throw runtimeError('ELECTRON_MBT_INVALID_PAYLOAD', 'Malformed invoke value envelope');
}
function internalArray(...items) {
  const values = [...items];
  // JSON.stringify must not consult a user-modified Array.prototype.toJSON.
  Object.setPrototypeOf(values, null);
  return values;
}
function envelope(value) {
  const seen = new WeakSet();
  let nodes = 0;
  function wrap(input, depth) {
    if (++nodes > LIMITS.nodes || depth > LIMITS.depth) exceeded();
    if (input === undefined) return internalArray(0);
    if (input === null || typeof input === 'string' || typeof input === 'boolean') {
      if (typeof input === 'string' && Buffer.byteLength(input, 'utf8') > LIMITS.bytes) exceeded();
      return internalArray(1, input);
    }
    if (typeof input === 'number') {
      if (!Number.isFinite(input) || Object.is(input, -0)) unsupported();
      return internalArray(1, input);
    }
    if (typeof input !== 'object' || types.isProxy(input) || seen.has(input)) unsupported();
    seen.add(input);
    // Do not pass application objects through JSON.stringify: accessors,
    // toJSON hooks, sparse arrays and cross-realm prototype changes are unsafe.
    const keys = Reflect.ownKeys(input);
    if (keys.length > LIMITS.nodes || keys.some(key => typeof key !== 'string')) exceededOrUnsupported(keys);
    if (Array.isArray(input)) {
      if (Object.getPrototypeOf(input) !== Array.prototype || keys.length !== input.length + 1) unsupported();
      if (input.length > LIMITS.nodes) exceeded();
      const result = [];
      for (let i = 0; i < input.length; i++) {
        const descriptor = Object.getOwnPropertyDescriptor(input, String(i));
        if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) unsupported();
        result.push(wrap(descriptor.value, depth + 1));
      }
      Object.setPrototypeOf(result, null);
      return internalArray(2, result);
    }
    const prototype = Object.getPrototypeOf(input);
    if (prototype !== Object.prototype && prototype !== null) unsupported();
    const result = [];
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(input, key);
      if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) unsupported();
      if (Buffer.byteLength(key, 'utf8') > LIMITS.bytes) exceeded();
      result.push(internalArray(key, wrap(descriptor.value, depth + 1)));
    }
    Object.setPrototypeOf(result, null);
    return internalArray(3, result);
  }
  return wrap(value, 0);
}
function exceededOrUnsupported(keys) {
  if (keys.length > LIMITS.nodes) exceeded();
  unsupported();
}
function encodeInvoke(value) {
  const raw = JSON.stringify(envelope(value));
  if (Buffer.byteLength(raw, 'utf8') > LIMITS.bytes) exceeded();
  return raw;
}
function decodeInvoke(raw) {
  if (typeof raw !== 'string') malformed();
  if (Buffer.byteLength(raw, 'utf8') > LIMITS.bytes) exceeded();
  let input;
  try { input = JSON.parse(raw); } catch { malformed(); }
  let nodes = 0;
  function unpack(entry, depth) {
    if (++nodes > LIMITS.nodes || depth > LIMITS.depth) exceeded();
    if (!Array.isArray(entry) || entry.length < 1 || entry.length > 2) malformed();
    const kind = entry[0];
    if (kind === 0) {
      if (entry.length !== 1) malformed();
      return undefined;
    }
    if (entry.length !== 2) malformed();
    if (kind === 1) {
      const value = entry[1];
      if (value !== null && typeof value !== 'string' && typeof value !== 'boolean' &&
          !(typeof value === 'number' && Number.isFinite(value) && !Object.is(value, -0))) malformed();
      return value;
    }
    if (!Array.isArray(entry[1]) || entry[1].length > LIMITS.nodes) malformed();
    if (kind === 2) return entry[1].map(child => unpack(child, depth + 1));
    if (kind !== 3) malformed();
    const pairs = [];
    const names = new Set();
    for (const pair of entry[1]) {
      if (!Array.isArray(pair) || pair.length !== 2 || typeof pair[0] !== 'string' || names.has(pair[0])) malformed();
      names.add(pair[0]);
      pairs.push([pair[0], unpack(pair[1], depth + 1)]);
    }
    // Object.fromEntries defines '__proto__' as data, never as a prototype setter.
    return Object.fromEntries(pairs);
  }
  return unpack(input, 0);
}
function cloneInvoke(value) {
  return decodeInvoke(encodeInvoke(value));
}
module.exports = { encodeInvoke, decodeInvoke, cloneInvoke };
