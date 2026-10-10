'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { TextDecoder } = require('node:util');
const { runtimeError } = require('./errors.cjs');
const { encodeData } = require('./bounded-json.cjs');
const compiled = path.resolve(__dirname, '../../dist/core.cjs');
if (!fs.existsSync(compiled)) throw runtimeError('ELECTRON_MBT_NOT_BUILT', 'Build the MoonBit boundary with node scripts/build-core.cjs.');
const core = require(compiled);
const limits = Object.freeze(JSON.parse(core.host_limits()));
const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
function fail(message) { throw runtimeError('ELECTRON_MBT_PROTOCOL', message); }
function checked(result) {
  const value = JSON.parse(result);
  if (!value.ok) fail(value.message);
  return value.value;
}
function wire(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length === 0 || bytes.length > limits.bytes) fail('Expected bounded Buffer');
  try { return decoder.decode(bytes); }
  catch { fail('Malformed UTF-8'); }
}
function decodeEnvelope(bytes) {
  const raw = wire(bytes);
  checked(core.host_validate(raw));
  // Duplicate names and semantic validation must run in MoonBit first; JSON.parse
  // here only materializes a checked wire value for Node consumers.
  return JSON.parse(raw);
}
function encodeEnvelope(value) {
  const raw = encodeData(value, limits);
  checked(core.host_validate(raw));
  return Buffer.from(raw, 'utf8');
}
function createSessionGate(expectedSession) {
  if (typeof expectedSession !== 'string') fail('Expected session string');
  const session = core.host_new(expectedSession);
  checked(core.host_status(session));
  return Object.freeze({
    register(value) {
      const raw = encodeData(value, limits);
      checked(core.host_register(session, raw));
      return JSON.parse(raw);
    },
    accept(bytes) {
      const raw = wire(bytes);
      checked(core.host_accept(session, raw));
      return JSON.parse(raw);
    },
    observe(bytes) {
      const raw = wire(bytes);
      checked(core.host_observe(session, raw));
      return JSON.parse(raw);
    },
    cancel(request) {
      if (typeof request !== 'number') fail('Expected numeric request ID');
      return checked(core.host_cancel(session, request));
    },
    pendingCount() { return core.host_pending(session); },
    close() { return JSON.parse(core.host_close(session)); },
  });
}
module.exports = {
  VERSION: limits.version, MAX_BYTES: limits.bytes, MAX_DEPTH: limits.depth,
  MAX_NODES: limits.nodes, MAX_PENDING: limits.pending,
  decodeEnvelope, encodeEnvelope, createSessionGate,
};
