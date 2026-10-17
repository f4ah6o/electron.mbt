'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { runtimeError } = require('../bridges/node/errors.cjs');

// Stub the MoonBit-backed protocol module only for the transport phase-boundary
// test; the real MoonBit contract and macOS CJS fixture run separately in CI.
const protocolPath = require.resolve('../bridges/node/host-protocol.cjs');
const nativePath = require.resolve('../bridges/node/native-host.cjs');
const priorProtocol = require.cache[protocolPath];
const priorNative = require.cache[nativePath];
require.cache[protocolPath] = {
  id: protocolPath, filename: protocolPath, loaded: true,
  exports: {
    MAX_BYTES: 1048576,
    encodeEnvelope(request) {
      if (request.payload.unpaired) {
        throw runtimeError('ELECTRON_MBT_PROTOCOL', 'Local encoding rejected a surrogate');
      }
      return Buffer.from(JSON.stringify(request));
    },
  },
};
delete require.cache[nativePath];
const { NativeHost } = require(nativePath);
if (priorProtocol) require.cache[protocolPath] = priorProtocol;
else delete require.cache[protocolPath];
if (priorNative) require.cache[nativePath] = priorNative;
else delete require.cache[nativePath];

function fakeTransport() {
  const host = Object.create(NativeHost.prototype);
  const observed = { registered: [], cancelled: [], sent: [], posted: [], aborted: 0 };
  host.session = 'a'.repeat(32);
  host.nextRequest = 0;
  host.dead = false;
  host.fd = 9;
  host.watchdogMs = 5000;
  host.pendingAsync = new Map();
  host.gate = {
    register(request) { observed.registered.push(request.request); },
    cancel(id) { observed.cancelled.push(id); },
    accept() { return { terminal: 'success', payload: { title: 'ready' } }; },
  };
  host.addon = {
    request(_fd, raw) { observed.sent.push(raw); return Buffer.from('native-reply'); },
  };
  host.loadWorker = {
    postMessage(message) { observed.posted.push(message); },
  };
  host.abort = () => { observed.aborted++; host.dead = true; };
  return { host, observed };
}

test('What: local synchronous wire encoding failure leaves host alive and later calls usable', () => {
  const { host, observed } = fakeTransport();
  assert.throws(() => host.request('set-window-title', 1, 0, { unpaired: true }),
    { code: 'ELECTRON_MBT_PROTOCOL' });
  assert.equal(host.dead, false);
  assert.deepEqual(observed.registered, []);
  assert.deepEqual(observed.sent, []);
  assert.equal(observed.aborted, 0);
  assert.deepEqual(host.request('get-window-title', 1, 0), { title: 'ready' });
  assert.deepEqual(observed.registered, [2]);
  assert.equal(observed.sent.length, 1);
});

test('What: MoonBit gate registration rejection before a socket write leaves host alive', () => {
  const { host, observed } = fakeTransport();
  host.gate.register = () => { throw runtimeError('ELECTRON_MBT_PROTOCOL', 'Local request rejected'); };
  assert.throws(() => host.request('get-window-title', 1, 0),
    { code: 'ELECTRON_MBT_PROTOCOL' });
  assert.equal(host.dead, false);
  assert.deepEqual(observed.sent, []);
  assert.equal(observed.aborted, 0);
});

test('What: local asynchronous encoding rejection does not poison later requests', async () => {
  const { host, observed } = fakeTransport();
  await assert.rejects(host.requestAsync('load-file', 1, 0, { unpaired: true }),
    { code: 'ELECTRON_MBT_PROTOCOL' });
  assert.equal(host.dead, false);
  assert.deepEqual(observed.registered, []);
  assert.deepEqual(observed.posted, []);
  assert.equal(observed.aborted, 0);
  const pending = host.requestAsync('load-file', 1, 0, { file: '/safe/index.html' });
  assert.equal(observed.posted.length, 1);
  host.onLoadReply({ request: 2, bytes: Buffer.from('native-reply') });
  assert.deepEqual(await pending, { title: 'ready' });
  assert.equal(host.dead, false);
});

test('What: invalid native protocol response after I/O still aborts the host', () => {
  const { host, observed } = fakeTransport();
  host.gate.accept = () => { throw runtimeError('ELECTRON_MBT_PROTOCOL', 'Forged native response'); };
  assert.throws(() => host.request('get-window-title', 1, 0),
    { code: 'ELECTRON_MBT_PROTOCOL' });
  assert.equal(observed.sent.length, 1);
  assert.equal(observed.aborted, 1);
  assert.equal(host.dead, true);
});
