'use strict';
const { runtimeError } = require('./errors.cjs');
const { types } = require('node:util');
const LIMITS = Object.freeze({ bytes: 1048576, depth: 64, nodes: 100000 });
function unsupported() {
  throw runtimeError('ELECTRON_MBT_UNSUPPORTED_VALUE', 'Value is outside the tiny JSON IPC profile');
}
function exceeded() {
  throw runtimeError('ELECTRON_MBT_LIMIT', 'IPC value exceeds the profile limits');
}
function encodeTiny(value) {
  const seen = new WeakSet();
  let nodes = 0, encodedBytes = 0;
  function account(bytes) {
    encodedBytes += bytes;
    if (encodedBytes > LIMITS.bytes) exceeded();
  }
  function copy(value, depth) {
    if (++nodes > LIMITS.nodes || depth > LIMITS.depth) exceeded();
    if (value === null || typeof value === 'boolean') { account(value === false ? 5 : 4); return value; }
    if (typeof value === 'string') {
      if (Buffer.byteLength(value, 'utf8') > LIMITS.bytes) exceeded();
      account(Buffer.byteLength(JSON.stringify(value), 'utf8'));
      return value;
    }
    if (typeof value === 'number') {
      if (!Number.isFinite(value) || Object.is(value, -0)) unsupported();
      account(String(value).length);
      return value;
    }
    if (typeof value !== 'object' || types.isProxy(value) || seen.has(value)) unsupported();
    seen.add(value);
    // Count keys before requesting any descriptors. A wide object can have a
    // modest key list but an enormous descriptor map, which must not bypass
    // the profile's node limit by exhausting the process heap first.
    const keys = Reflect.ownKeys(value);
    if (keys.length > LIMITS.nodes) exceeded();
    if (keys.some(key => typeof key === 'symbol')) unsupported();
    if (Array.isArray(value)) {
      if (Object.getPrototypeOf(value) !== Array.prototype) unsupported();
      if (value.length > LIMITS.nodes) exceeded();
      account(2 + Math.max(0, value.length - 1));
      if (keys.length !== value.length + 1) unsupported();
      const output = [];
      for (let index = 0; index < value.length; index++) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (!descriptor || !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable) unsupported();
        output.push(copy(descriptor.value, depth + 1));
      }
      return output;
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) unsupported();
    account(2 + Math.max(0, keys.length - 1));
    const output = Object.create(null);
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) unsupported();
      if (Buffer.byteLength(key, 'utf8') > LIMITS.bytes) exceeded();
      account(Buffer.byteLength(JSON.stringify(key), 'utf8') + 1);
      output[key] = copy(descriptor.value, depth + 1);
    }
    return output;
  }
  // JSON.stringify on the input would invoke toJSON/getters and erase unsupported values.
  const wire = JSON.stringify(copy(value, 0));
  if (Buffer.byteLength(wire, 'utf8') > LIMITS.bytes) exceeded();
  return wire;
}
function decodeTiny(bytes) {
  if (!(bytes instanceof Uint8Array)) throw runtimeError('ELECTRON_MBT_INVALID_ARGUMENT', 'Expected encoded bytes');
  if (bytes.byteLength > LIMITS.bytes) exceeded();
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { throw runtimeError('ELECTRON_MBT_INVALID_PAYLOAD', 'Invalid UTF-8'); }
  let depth = 0, quoted = false, escaped = false;
  for (const character of text) {
    if (quoted) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') quoted = false;
    } else if (character === '"') quoted = true;
    else if (character === '{' || character === '[') {
      if (++depth > LIMITS.depth + 1) exceeded();
    } else if (character === '}' || character === ']') depth--;
  }
  let value;
  try { value = JSON.parse(text); }
  catch { throw runtimeError('ELECTRON_MBT_INVALID_PAYLOAD', 'Invalid JSON'); }
  encodeTiny(value);
  return value;
}
module.exports = { encodeTiny, decodeTiny, LIMITS };
