'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { encodeEnvelope, decodeEnvelope, createSessionGate, MAX_BYTES } = require('../bridges/node/host-protocol.cjs');
const session = '0123456789abcdef0123456789abcdef';
function envelope(changes = {}) {
  return { version: 1, session, request: 1, window: 0, generation: 0, operation: 'hello', payload: {}, ...changes };
}
test('What: valid native control envelope round trips', () => {
  assert.deepEqual(decodeEnvelope(encodeEnvelope(envelope())), envelope());
});
test('What: malformed, oversized, unknown-version and unsupported operations fail closed', () => {
  for (const bytes of [Buffer.from('{'), Buffer.alloc(MAX_BYTES + 1), Buffer.from(JSON.stringify(envelope({ version: 2 }))), Buffer.from(JSON.stringify(envelope({ operation: 'eval' })))]) {
    assert.throws(() => decodeEnvelope(bytes), { code: 'ELECTRON_MBT_PROTOCOL' });
  }
});
test('What: spoofed session and duplicate terminal completion are rejected', () => {
  const gate = createSessionGate(session);
  assert.throws(() => gate.accept(encodeEnvelope(envelope({ session: 'f'.repeat(32) }))), { code: 'ELECTRON_MBT_PROTOCOL' });
  const done = encodeEnvelope(envelope({ terminal: 'success' }));
  assert.equal(gate.accept(done).terminal, 'success');
  assert.throws(() => gate.accept(done), { code: 'ELECTRON_MBT_PROTOCOL' });
});
test('What: closed sessions reject subsequent messages', () => {
  const gate = createSessionGate(session);
  gate.close();
  assert.throws(() => gate.accept(encodeEnvelope(envelope())), { code: 'ELECTRON_MBT_PROTOCOL' });
});
