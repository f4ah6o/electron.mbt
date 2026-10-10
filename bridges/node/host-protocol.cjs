'use strict';
const { TextDecoder } = require('node:util');
const { runtimeError } = require('./errors.cjs');

const VERSION = 1;
const MAX_BYTES = 1024 * 1024;
const MAX_DEPTH = 64;
const MAX_NODES = 100000;
const MAX_PENDING = 256;
const OPS = new Set(['hello', 'ready', 'create-window', 'show-window', 'load-file', 'close-window', 'destroy-window', 'shutdown']);
const TERMINALS = new Set(['success', 'failure', 'cancelled']);
const decoder = new TextDecoder('utf-8', { fatal: true });

function fail(message) { throw runtimeError('ELECTRON_MBT_PROTOCOL', message); }
function record(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype;
}
function uint(value) { return Number.isSafeInteger(value) && value >= 0; }
function validateTree(root) {
  let count = 0;
  const stack = [[root, 0]];
  while (stack.length) {
    const [value, depth] = stack.pop();
    if (++count > MAX_NODES || depth > MAX_DEPTH) fail('Payload complexity limit exceeded');
    if (value === null || typeof value === 'string' || typeof value === 'boolean') continue;
    if (typeof value === 'number' && Number.isFinite(value) && !Object.is(value, -0)) continue;
    if (typeof value !== 'object' || (!Array.isArray(value) && !record(value))) fail('Unsupported payload value');
    const keys = Object.keys(value);
    if (count + keys.length > MAX_NODES) fail('Payload cardinality limit exceeded');
    if (Array.isArray(value)) {
      if (keys.length !== value.length) fail('Sparse or extended array');
      for (let i = 0; i < keys.length; i++) if (keys[i] !== String(i)) fail('Invalid array index');
    }
    for (const key of keys) {
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') fail('Unsafe payload key');
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !Object.hasOwn(descriptor, 'value')) fail('Accessor payload is forbidden');
      stack.push([descriptor.value, depth + 1]);
    }
  }
}
function decodeEnvelope(bytes) {
  if (!Buffer.isBuffer(bytes)) fail('A bounded Buffer is required');
  if (bytes.length === 0 || bytes.length > MAX_BYTES) fail('Envelope exceeds bounds');
  let value;
  try { value = JSON.parse(decoder.decode(bytes)); }
  catch { fail('Malformed UTF-8 or JSON envelope'); }
  if (!record(value)) fail('Invalid envelope shape');
  const required = ['version', 'session', 'request', 'window', 'generation', 'operation', 'payload'];
  const allowed = [...required, 'terminal'];
  if (!required.every(key => Object.hasOwn(value, key)) || Object.keys(value).some(key => !allowed.includes(key))) fail('Invalid envelope fields');
  if (value.version !== VERSION) fail('Unknown protocol version');
  if (typeof value.session !== 'string' || !/^[a-f0-9]{32}$/.test(value.session)) fail('Missing session identifier');
  if (!uint(value.request) || value.request === 0 || !uint(value.window) || !uint(value.generation)) fail('Invalid request or document identity');
  if (typeof value.operation !== 'string' || !OPS.has(value.operation)) fail('Unsupported operation');
  if (!record(value.payload)) fail('Payload must be a plain record');
  if (Object.hasOwn(value, 'terminal') && !TERMINALS.has(value.terminal)) fail('Invalid terminal result');
  validateTree(value.payload);
  return value;
}
function encodeEnvelope(value) {
  let bytes;
  try { bytes = Buffer.from(JSON.stringify(value), 'utf8'); }
  catch { fail('Envelope cannot be serialized'); }
  decodeEnvelope(bytes);
  return bytes;
}
function createSessionGate(expectedSession) {
  if (typeof expectedSession !== 'string' || !/^[a-f0-9]{32}$/.test(expectedSession)) fail('Invalid trusted session');
  const pending = new Map();
  let closed = false;
  let lastIssued = 0;
  function ensureOpen() { if (closed) fail('Session closed'); }
  function authenticate(value) {
    if (value.session !== expectedSession) fail('Unauthenticated session');
  }
  return Object.freeze({
    register(value) {
      ensureOpen();
      const request = decodeEnvelope(encodeEnvelope(value));
      authenticate(request);
      if (request.terminal !== undefined) fail('Cannot register a completion');
      if (pending.size >= MAX_PENDING || request.request <= lastIssued) fail('Reused, out-of-order or excessive pending request');
      lastIssued = request.request;
      pending.set(request.request, { window: request.window, generation: request.generation, operation: request.operation });
      return request;
    },
    accept(bytes) {
      ensureOpen();
      const envelope = decodeEnvelope(bytes);
      authenticate(envelope);
      if (envelope.terminal === undefined) fail('Expected a terminal response');
      const expected = pending.get(envelope.request);
      if (!expected) fail('Unknown, duplicate or late completion');
      if (expected.window !== envelope.window || expected.generation !== envelope.generation || expected.operation !== envelope.operation) fail('Stale or mismatched completion');
      pending.delete(envelope.request);
      return envelope;
    },
    cancel(request) { ensureOpen(); return pending.delete(request); },
    pendingCount() { return pending.size; },
    close() { closed = true; pending.clear(); },
  });
}
module.exports = { VERSION, MAX_BYTES, MAX_DEPTH, MAX_NODES, MAX_PENDING, decodeEnvelope, encodeEnvelope, createSessionGate };
