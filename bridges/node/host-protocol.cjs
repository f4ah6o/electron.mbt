'use strict';
const { runtimeError } = require('./errors.cjs');

const VERSION = 1;
const MAX_BYTES = 1024 * 1024;
const OPS = new Set(['hello', 'ready', 'create-window', 'show-window', 'load-file', 'close-window', 'destroy-window', 'shutdown']);
const TERMINALS = new Set(['success', 'failure', 'cancelled']);

function fail(message) {
  throw runtimeError('ELECTRON_MBT_PROTOCOL', message);
}
function record(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype;
}
function ownKeys(value, allowed) {
  return Object.keys(value).every((key) => allowed.includes(key));
}
function uint(value) {
  return Number.isSafeInteger(value) && value >= 0;
}
function decodeEnvelope(bytes) {
  if (!Buffer.isBuffer(bytes)) fail('A bounded Buffer is required');
  if (bytes.length === 0 || bytes.length > MAX_BYTES) fail('Envelope exceeds bounds');
  let value;
  try { value = JSON.parse(bytes.toString('utf8')); }
  catch { fail('Malformed JSON envelope'); }
  if (!record(value) || !ownKeys(value, ['version', 'session', 'request', 'window', 'generation', 'operation', 'payload', 'terminal'])) fail('Invalid envelope shape');
  if (value.version !== VERSION) fail('Unknown protocol version');
  if (typeof value.session !== 'string' || !/^[a-f0-9]{32}$/.test(value.session)) fail('Missing session identifier');
  if (!uint(value.request) || value.request === 0 || !uint(value.window) || !uint(value.generation)) fail('Invalid request or document identity');
  if (typeof value.operation !== 'string' || !OPS.has(value.operation)) fail('Unsupported operation');
  if (!Object.hasOwn(value, 'payload') || !record(value.payload)) fail('Payload must be a plain record');
  if (Object.hasOwn(value, 'terminal') && !TERMINALS.has(value.terminal)) fail('Invalid terminal result');
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
  const completed = new Set();
  let closed = false;
  return Object.freeze({
    accept(bytes) {
      if (closed) fail('Session closed');
      const envelope = decodeEnvelope(bytes);
      if (envelope.session !== expectedSession) fail('Unauthenticated session');
      if (envelope.terminal !== undefined) {
        if (completed.has(envelope.request)) fail('Duplicate completion');
        completed.add(envelope.request);
      }
      return envelope;
    },
    close() { closed = true; completed.clear(); },
  });
}
module.exports = { VERSION, MAX_BYTES, decodeEnvelope, encodeEnvelope, createSessionGate };
