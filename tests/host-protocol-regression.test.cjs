'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../dist/core.cjs');
const { encodeEnvelope, decodeEnvelope, createSessionGate, MAX_BYTES, MAX_DEPTH, MAX_NODES, MAX_PENDING } = require('../bridges/node/host-protocol.cjs');
const session = '0123456789abcdef0123456789abcdef';
const error = { code: 'ELECTRON_MBT_PROTOCOL' };
const envelope = (changes = {}) => ({ version: 1, session, request: 1, window: 2, generation: 3, operation: 'show-window', payload: {}, ...changes });
const response = (changes = {}) => envelope({ terminal: 'success', ...changes });
const raw = (value) => Buffer.from(JSON.stringify(value));

for (const [name, payload] of [
  ['undefined', { value: undefined }], ['NaN', { value: NaN }], ['negative zero', { value: -0 }],
  ['sparse array', { value: [,] }], ['BigInt', { value: 1n }], ['Date', { value: new Date() }],
]) {
  test(`What: ${name} is rejected on encode and register without consuming an ID`, () => {
    const gate = createSessionGate(session);
    assert.throws(() => encodeEnvelope(envelope({ payload })), error);
    assert.throws(() => gate.register(envelope({ payload })), error);
    assert.equal(gate.pendingCount(), 0);
    gate.register(envelope());
    assert.equal(gate.pendingCount(), 1);
  });
}
test('What: getters, toJSON and proxies cannot execute in envelope or payload reflection', () => {
  let calls = 0;
  const payload = Object.defineProperty({}, 'value', { enumerable: true, get() { calls++; return 1; } });
  const custom = { toJSON() { calls++; return {}; } };
  const proxy = new Proxy({}, { ownKeys() { calls++; return []; } });
  for (const value of [envelope({ payload }), envelope({ payload: custom }), envelope({ payload: proxy }), Object.defineProperty(envelope(), 'request', { get() { calls++; return 1; } })]) {
    assert.throws(() => encodeEnvelope(value), error);
    assert.throws(() => createSessionGate(session).register(value), error);
  }
  assert.equal(calls, 0);
});
test('What: literal, escaped and nested duplicate JSON names never consume pending work', () => {
  const valid = JSON.stringify(response());
  const duplicates = [
    valid.replace('"operation":"show-window"', '"operation":"close-window","operation":"show-window"'),
    valid.replace('"operation":"show-window"', '"operation":"show-window","\\u006fperation":"show-window"'),
    valid.replace('"payload":{}', '"payload":{"nested":{"a":1,"\\u0061":2}}'),
    valid.replace('"session":', '"session":"ffffffffffffffffffffffffffffffff","session":'),
  ];
  for (const text of duplicates) {
    const gate = createSessionGate(session); gate.register(envelope());
    assert.throws(() => decodeEnvelope(Buffer.from(text)), error);
    assert.throws(() => gate.accept(Buffer.from(text)), error);
    assert.equal(gate.pendingCount(), 1);
    assert.equal(JSON.parse(core.host_validate(text)).ok, false);
    gate.accept(Buffer.from(valid));
  }
});
test('What: malformed grammar, invalid UTF-8 inside strings and BOM are rejected', () => {
  const value = JSON.stringify(envelope({ payload: { value: 'placeholder' } }));
  const parts = value.split('placeholder');
  const badUtf8 = Buffer.concat([Buffer.from(parts[0]), Buffer.from([0xff]), Buffer.from(parts[1])]);
  for (const bytes of [badUtf8, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), raw(envelope())]), raw(envelope()).subarray(0, 30), Buffer.from(value + '{}'), Buffer.from(value.replace('"value":', '"value" ')), Buffer.from(value.replace('"placeholder"', '1e400'))]) {
    assert.throws(() => decodeEnvelope(bytes), error);
  }
});
test('What: wire and outbound bounds use actual encoded bytes', () => {
  const base = envelope({ payload: { text: '' } });
  const overhead = raw(base).length;
  const full = envelope({ payload: { text: 'x'.repeat(MAX_BYTES - overhead) } });
  assert.equal(encodeEnvelope(full).length, MAX_BYTES);
  assert.deepEqual(decodeEnvelope(raw(full)), full);
  full.payload.text += 'x';
  assert.throws(() => encodeEnvelope(full), error);
  assert.throws(() => decodeEnvelope(raw(full)), error);
  assert.throws(() => encodeEnvelope(envelope({ payload: { text: '\u0000'.repeat(MAX_BYTES) } })), error);
});
test('What: MoonBit enforces payload depth, cardinality and unsafe-key policy', () => {
  let payload = {};
  for (let i = 0; i < MAX_DEPTH; i++) payload = { child: payload };
  assert.doesNotThrow(() => encodeEnvelope(envelope({ payload })));
  assert.throws(() => encodeEnvelope(envelope({ payload: { child: payload } })), error);
  assert.throws(() => decodeEnvelope(raw(envelope({ payload: { nodes: Array(MAX_NODES).fill(0) } }))), error);
  for (const key of ['__proto__', 'constructor', 'prototype']) {
    const value = envelope({ payload: JSON.parse(`{"nested":{"${key}":1}}`) });
    assert.throws(() => encodeEnvelope(value), error);
    assert.equal(JSON.parse(core.host_validate(JSON.stringify(value))).ok, false);
  }
});
test('What: MoonBit owns operation allowlists and every correlation field', () => {
  for (const change of [{ version: 2 }, { operation: 'eval' }, { terminal: 'done' }, { request: 0 }, { window: -1 }, { generation: 1.5 }]) {
    assert.equal(JSON.parse(core.host_validate(JSON.stringify(envelope(change)))).ok, false);
  }
  const gate = createSessionGate(session); gate.register(envelope());
  for (const change of [{ session: 'f'.repeat(32) }, { request: 2 }, { window: 3 }, { generation: 4 }, { operation: 'close-window' }]) {
    assert.throws(() => gate.accept(raw(response(change))), error);
    assert.equal(gate.pendingCount(), 1);
  }
});
test('What: the total pending byte budget recovers without allowing ID replay', () => {
  const base = envelope({ payload: { text: '' } });
  const payload = { text: 'x'.repeat(MAX_BYTES - raw(base).length) };
  const gate = createSessionGate(session);
  for (let request = 1; request <= 4; request++) gate.register(envelope({ request, payload }));
  assert.throws(() => gate.register(envelope({ request: 5, payload })), error);
  assert.equal(gate.cancel(1), true);
  gate.register(envelope({ request: 5, payload }));
  assert.throws(() => gate.register(envelope()), error);
  assert.throws(() => gate.accept(raw(response())), error);
  assert.deepEqual(gate.close().sort(), [2, 3, 4, 5]);
  assert.deepEqual(gate.close(), []);
});
test('What: reverse-order replies, ID exhaustion and close retain exactly-once behavior', () => {
  const gate = createSessionGate(session);
  gate.register(envelope()); gate.register(envelope({ request: 2 }));
  gate.accept(raw(response({ request: 2 })));
  gate.accept(raw(response()));
  assert.throws(() => gate.register(envelope()), error);
  gate.register(envelope({ request: Number.MAX_SAFE_INTEGER }));
  assert.throws(() => gate.register(envelope({ request: Number.MAX_SAFE_INTEGER + 1 })), error);
  assert.equal(gate.pendingCount(), 1);
  assert.deepEqual(gate.close(), [Number.MAX_SAFE_INTEGER]);
  assert.throws(() => gate.accept(raw(response({ request: Number.MAX_SAFE_INTEGER }))), error);
});
test('What: Node uses the actual compiled MoonBit limits and not local policy constants', () => {
  const limits = JSON.parse(core.host_limits());
  assert.equal(MAX_BYTES, limits.bytes); assert.equal(MAX_DEPTH, limits.depth);
  assert.equal(MAX_NODES, limits.nodes); assert.equal(MAX_PENDING, limits.pending);
  assert.equal(JSON.parse(core.host_status(core.host_new('invalid'))).ok, false);
  assert.throws(() => createSessionGate('invalid'), error);
});
