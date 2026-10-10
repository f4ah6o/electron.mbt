'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../dist/core.cjs');
const { decodeEnvelope, createSessionGate } = require('../bridges/node/host-protocol.cjs');
const session = '0123456789abcdef0123456789abcdef';
const error = { code: 'ELECTRON_MBT_PROTOCOL' };
const envelope = (changes = {}) => ({ version: 1, session, request: 1, window: 2, generation: 3, operation: 'show-window', payload: {}, ...changes });
const response = (changes = {}) => envelope({ terminal: 'success', ...changes });

test('What: fractional lexemes cannot round into valid correlated identities', () => {
  const valid = JSON.stringify(response());
  const malformed = [
    valid.replace('"request":1', '"request":1.00000000000000001'),
    valid.replace('"request":1', '"request":0.99999999999999999'),
    valid.replace('"request":1', '"request":100000000000000001e-17'),
    valid.replace('"version":1', '"version":1.00000000000000001'),
    valid.replace('"window":2', '"window":2.00000000000000001'),
    valid.replace('"generation":3', '"generation":3.00000000000000001'),
    valid.replace('"window":2', '"window":1e-400'),
  ];
  for (const text of malformed) {
    const gate = createSessionGate(session); gate.register(envelope());
    assert.equal(JSON.parse(core.host_validate(text)).ok, false);
    assert.throws(() => decodeEnvelope(Buffer.from(text)), error);
    assert.throws(() => gate.accept(Buffer.from(text)), error);
    assert.equal(gate.pendingCount(), 1);
    gate.accept(Buffer.from(valid));
  }
});
test('What: exact safe integers in decimal or exponent notation still correlate', () => {
  for (const token of ['1.0', '100e-2', '0.01e2', '1.00000000000000000', '1e+0000']) {
    const gate = createSessionGate(session); gate.register(envelope());
    const text = JSON.stringify(response()).replace('"request":1', `"request":${token}`);
    assert.equal(gate.accept(Buffer.from(text)).request, 1);
    assert.equal(gate.pendingCount(), 0);
  }
  const gate = createSessionGate(session);
  gate.register(envelope({ request: Number.MAX_SAFE_INTEGER }));
  const base = JSON.stringify(response({ request: Number.MAX_SAFE_INTEGER }));
  for (const token of ['9007199254740991.1', '9007199254740990.9', '9007199254740993', '1e9999999999999999999999']) {
    assert.throws(() => gate.accept(Buffer.from(base.replace('9007199254740991', token))), error);
    assert.equal(gate.pendingCount(), 1);
  }
  const exact = base.replace('9007199254740991', '9.007199254740991e15');
  assert.equal(gate.accept(Buffer.from(exact)).request, Number.MAX_SAFE_INTEGER);
});
