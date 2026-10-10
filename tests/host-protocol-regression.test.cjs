'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../dist/core.cjs');
const { encodeEnvelope, decodeEnvelope, createSessionGate, MAX_BYTES, MAX_DEPTH, MAX_NODES, MAX_PENDING } = require('../bridges/node/host-protocol.cjs');
const session = '0123456789abcdef0123456789abcdef';
const error = { code: 'ELECTRON_MBT_PROTOCOL' };
const envelope = (changes = {}) => ({ version: 1, session, request: 1, window: 2, generation: 3, operation: 'show-window', payload: {}, ...changes });
const response = (changes = {}) => envelope({ terminal: 'success', payload: { visible: true }, ...changes });
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
    valid.replace('"payload":{"visible":true}', '"payload":{"visible":true,"nested":{"a":1,"\\u0061":2}}'),
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

test('What: MoonBit validates title envelopes and correlates the exact native title', () => {
  const get = envelope({ operation: 'get-window-title', payload: {} });
  const gate = createSessionGate(session);
  gate.register(get);
  assert.throws(() => gate.accept(raw({ ...get, payload: { title: 4 }, terminal: 'success' })), error);
  assert.equal(gate.pendingCount(), 1);
  gate.accept(raw({ ...get, payload: { title: '日本語' }, terminal: 'success' }));
  assert.equal(gate.pendingCount(), 0);

  const set = envelope({ operation: 'set-window-title', payload: { title: 'before' } });
  const titleGate = createSessionGate(session);
  titleGate.register(set);
  assert.throws(() => titleGate.accept(raw({ ...set, payload: { title: 'after' }, terminal: 'success' })), error);
  assert.equal(titleGate.pendingCount(), 1);
  titleGate.accept(raw({ ...set, terminal: 'success' }));
  assert.equal(titleGate.pendingCount(), 0);
  assert.throws(() => encodeEnvelope({ ...set, payload: { title: 0 } }), error);
  assert.throws(() => encodeEnvelope({ ...get, payload: { title: 'injected' } }), error);
});

test('What: native URL reads accept only bounded URL strings in successful ACKs', () => {
  const request = envelope({ operation: 'get-web-contents-url', payload: {} });
  for (const badPayload of [{}, { url: 42 }, { url: null }, { url: [] },
    { url: 'file:///index.html', extra: true }, { url: 'x'.repeat(8193) }]) {
    const gate = createSessionGate(session);
    gate.register(request);
    assert.throws(() => gate.accept(raw({ ...request, payload: badPayload, terminal: 'success' })), error);
    assert.equal(gate.pendingCount(), 1);
    gate.accept(raw({ ...request, payload: { url: '' }, terminal: 'success' }));
  }
  assert.throws(() => encodeEnvelope({ ...request, payload: { forged: true } }), error);
  const gate = createSessionGate(session);
  gate.register(request);
  gate.accept(raw({ ...request, payload: { url: 'file:///app/index.html' }, terminal: 'success' }));
  assert.equal(gate.pendingCount(), 0);
});

test('What: native page title replies reject missing, malformed, oversized or extra members', () => {
  const request = envelope({ operation: 'get-web-contents-title', payload: {} });
  for (const badPayload of [{}, { title: null }, { title: 1 }, { title: [] },
    { title: 'safe', extra: true }, { title: 'x'.repeat(4097) }]) {
    const gate = createSessionGate(session);
    gate.register(request);
    assert.throws(() => gate.accept(raw({ ...request, terminal: 'success', payload: badPayload })), error);
    assert.equal(gate.pendingCount(), 1);
    gate.accept(raw({ ...request, terminal: 'success', payload: { title: 'real 😀' } }));
    assert.equal(gate.pendingCount(), 0);
  }
  assert.throws(() => encodeEnvelope({ ...request, payload: { injected: true } }), error);
  const gate = createSessionGate(session);
  gate.register(request);
  gate.accept(raw({ ...request, terminal: 'success', payload: { title: '' } }));
  assert.equal(gate.pendingCount(), 0);
});

test('What: native get-window-bounds success requires exact bounded integer geometry', () => {
  const request = envelope({ operation: 'get-window-bounds', payload: {} });
  for (const bad of [
    {}, { x: 1, y: 2, width: 640 }, { x: 1, y: 2, width: 640, height: 480, extra: 1 },
    { x: null, y: 2, width: 640, height: 480 },
    { x: 1.5, y: 2, width: 640, height: 480 },
    { x: 1, y: 2, width: 0, height: 480 },
    { x: 1, y: 2, width: 640, height: -1 },
    { x: 1048577, y: 2, width: 640, height: 480 },
    { x: 1, y: 2, width: 32769, height: 480 },
  ]) {
    const gate = createSessionGate(session);
    gate.register(request);
    assert.throws(() => gate.accept(raw({ ...request, payload: bad, terminal: 'success' })), error);
    assert.equal(gate.pendingCount(), 1);
    gate.accept(raw({ ...request, payload: { x: -35, y: 25, width: 640, height: 504 }, terminal: 'success' }));
    assert.equal(gate.pendingCount(), 0);
  }
  assert.throws(() => encodeEnvelope({ ...request, payload: { injected: true } }), error);
  const failed = createSessionGate(session);
  failed.register(request);
  failed.accept(raw({ ...request, payload: { code: 'ELECTRON_MBT_WINDOW_UNKNOWN' }, terminal: 'failure' }));
  assert.equal(failed.pendingCount(), 0);
});

test('What: set-window-bounds rejects unsafe partial requests and malformed native completions', () => {
  const requested = envelope({ operation: 'set-window-bounds', payload: { width: 700 } });
  for (const payload of [{ x: 1.5 }, { x: -0 }, { x: 1048577 }, { y: false },
    { width: 99 }, { height: 4097 }, { nonsense: 3 }, { width: 640, height: 480, x: 0, y: 0, extra: true }]) {
    assert.throws(() => encodeEnvelope({ ...requested, payload }), error);
  }
  assert.doesNotThrow(() => encodeEnvelope(requested));
  assert.doesNotThrow(() => encodeEnvelope({ ...requested, payload: {} }));
  for (const bad of [{}, { x: 3, y: 4, width: 700 },
    { x: 3, y: 4, width: 700, height: 500, extra: 1 },
    { x: 3, y: 4, width: 700, height: 0 }]) {
    const gate = createSessionGate(session);
    gate.register(requested);
    assert.throws(() => gate.accept(raw({ ...requested, terminal: 'success', payload: bad })), error);
    assert.equal(gate.pendingCount(), 1);
    gate.accept(raw({ ...requested, terminal: 'success', payload: { x: -20, y: 50, width: 700, height: 504 } }));
    assert.equal(gate.pendingCount(), 0);
  }
  const gate = createSessionGate(session);
  gate.register(requested);
  gate.accept(raw({ ...requested, terminal: 'failure', payload: { code: 'ELECTRON_MBT_STALE_DOCUMENT' } }));
  assert.equal(gate.pendingCount(), 0);
});


test('What: raw rounded fractional bounds lexemes are rejected before Node number coercion', () => {
  const request = envelope({ operation: 'get-window-bounds', payload: {} });
  const validAck = JSON.stringify({ ...request, terminal: 'success',
    payload: { x: -20, y: 50, width: 640, height: 480 } });
  const substitutions = [
    ['"x":-20', '"x":-20.00000000000000001'],
    ['"x":-20', '"x":-19.99999999999999999'],
    ['"y":50', '"y":50.00000000000000001'],
    ['"width":640', '"width":639.99999999999999999'],
    ['"height":480', '"height":4.80000000000000000001e2'],
  ];
  const gate = createSessionGate(session);
  gate.register(request);
  for (const [original, replacement] of substitutions) {
    assert.ok(validAck.includes(original));
    const invalidAck = validAck.replace(original, replacement);
    assert.equal(JSON.parse(core.host_validate(invalidAck)).ok, false);
    assert.throws(() => gate.accept(Buffer.from(invalidAck)), error);
    assert.equal(gate.pendingCount(), 1);
  }
  const integerAck = validAck.replace('"x":-20', '"x":-2.0e1')
    .replace('"width":640', '"width":6.4e2');
  assert.equal(gate.accept(Buffer.from(integerAck)).operation, 'get-window-bounds');
  assert.equal(gate.pendingCount(), 0);

  const set = envelope({ operation: 'set-window-bounds',
    payload: { x: -20, y: 50, width: 640, height: 480 } });
  const validSet = JSON.stringify(set);
  for (const [original, replacement] of substitutions) {
    const invalidSet = validSet.replace(original, replacement);
    assert.equal(JSON.parse(core.host_validate(invalidSet)).ok, false);
    const rawSession = core.host_new(session);
    assert.equal(JSON.parse(core.host_register(rawSession, invalidSet)).ok, false);
    assert.equal(core.host_pending(rawSession), 0);
  }
  assert.equal(JSON.parse(core.host_validate(validSet.replace('"width":640', '"width":6.4e2'))).ok, true);
});
