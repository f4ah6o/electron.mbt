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
  gate.register(envelope());
  const done = encodeEnvelope(envelope({ terminal: 'success' }));
  assert.equal(gate.accept(done).terminal, 'success');
  assert.throws(() => gate.accept(done), { code: 'ELECTRON_MBT_PROTOCOL' });
});
test('What: MoonBit validates visibility successes before releasing correlated work', () => {
  const cases = [
    ['show-window', true], ['hide-window', false],
    ['is-window-visible', true], ['is-window-visible', false],
  ];
  for (const [operation, expected] of cases) {
    const request = envelope({ operation, window: 3, generation: 2 });
    const gate = createSessionGate(session);
    assert.deepEqual(decodeEnvelope(encodeEnvelope(request)), request);
    gate.register(request);
    const invalid = [{}, { visible: null }, { visible: 'true' }, { visible: 1 },
      { visible: [] }, { visible: expected, extra: true }];
    if (operation !== 'is-window-visible') invalid.push({ visible: !expected });
    for (const payload of invalid) {
      const frame = { ...request, terminal: 'success', payload };
      assert.throws(() => encodeEnvelope(frame), { code: 'ELECTRON_MBT_PROTOCOL' });
      assert.throws(() => gate.accept(Buffer.from(JSON.stringify(frame))),
        { code: 'ELECTRON_MBT_PROTOCOL' });
      assert.equal(gate.pendingCount(), 1);
    }
    const completed = { ...request, terminal: 'success', payload: { visible: expected } };
    assert.equal(gate.accept(encodeEnvelope(completed)).operation, operation);
    assert.equal(gate.pendingCount(), 0);
    assert.throws(() => gate.accept(encodeEnvelope(completed)),
      { code: 'ELECTRON_MBT_PROTOCOL' });
  }
  assert.throws(() => encodeEnvelope(envelope({ operation: 'toggle-visibility' })),
    { code: 'ELECTRON_MBT_PROTOCOL' });
});
test('What: visibility failures and cancellations correlate without success fields', () => {
  for (const terminal of ['failure', 'cancelled']) {
    const gate = createSessionGate(session);
    const request = envelope({ operation: 'show-window', window: 3 });
    gate.register(request);
    const completion = { ...request, payload: { code: 'ELECTRON_MBT_STALE_DOCUMENT' }, terminal };
    assert.equal(gate.accept(encodeEnvelope(completion)).terminal, terminal);
    assert.equal(gate.pendingCount(), 0);
  }
});
test('What: closed sessions reject subsequent messages', () => {
  const gate = createSessionGate(session);
  gate.close();
  assert.throws(() => gate.accept(encodeEnvelope(envelope())), { code: 'ELECTRON_MBT_PROTOCOL' });
});

test('What: unknown and stale replies cannot complete a pending request', () => {
  const gate = createSessionGate(session);
  gate.register(envelope({ request: 7, window: 2, generation: 3, operation: 'show-window' }));
  for (const change of [{ request: 8 }, { window: 3 }, { generation: 4 }, { operation: 'close-window' }]) {
    assert.throws(() => gate.accept(encodeEnvelope(envelope({ request: 7, window: 2, generation: 3, operation: 'show-window', terminal: 'success', ...change }))), { code: 'ELECTRON_MBT_PROTOCOL' });
  }
  assert.equal(gate.pendingCount(), 1);
  gate.cancel(7);
  assert.throws(() => gate.accept(encodeEnvelope(envelope({ request: 7, window: 2, generation: 3, operation: 'show-window', terminal: 'success' }))), { code: 'ELECTRON_MBT_PROTOCOL' });
});
test('What: pending requests are bounded and cleared on close', () => {
  const gate = createSessionGate(session);
  for (let request = 1; request <= 256; request++) gate.register(envelope({ request }));
  assert.throws(() => gate.register(envelope({ request: 257 })), { code: 'ELECTRON_MBT_PROTOCOL' });
  gate.close();
  assert.equal(gate.pendingCount(), 0);
});
test('What: unsafe keys, excessive depth and invalid UTF-8 are rejected', () => {
  const unsafe = '{"version":1,"session":"' + session + '","request":1,"window":0,"generation":0,"operation":"hello","payload":{"__proto__":1}}';
  assert.throws(() => decodeEnvelope(Buffer.from(unsafe)), { code: 'ELECTRON_MBT_PROTOCOL' });
  let deep = {};
  for (let i = 0; i < 70; i++) deep = { child: deep };
  assert.throws(() => encodeEnvelope(envelope({ payload: deep })), { code: 'ELECTRON_MBT_PROTOCOL' });
  assert.throws(() => decodeEnvelope(Buffer.from([0xff])), { code: 'ELECTRON_MBT_PROTOCOL' });
});

test('What: completed request IDs cannot be reused by late responses', () => {
  const gate = createSessionGate(session);
  gate.register(envelope({ request: 10 }));
  gate.accept(encodeEnvelope(envelope({ request: 10, terminal: 'success' })));
  assert.throws(() => gate.register(envelope({ request: 10 })), { code: 'ELECTRON_MBT_PROTOCOL' });
  assert.throws(() => gate.accept(encodeEnvelope(envelope({ request: 10, terminal: 'success' }))), { code: 'ELECTRON_MBT_PROTOCOL' });
  gate.register(envelope({ request: 11 }));
  assert.equal(gate.pendingCount(), 1);
});
test('What: cancelled IDs cannot be reused or replayed', () => {
  const gate = createSessionGate(session);
  gate.register(envelope({ request: 20 }));
  assert.equal(gate.cancel(20), true);
  assert.throws(() => gate.register(envelope({ request: 20 })), { code: 'ELECTRON_MBT_PROTOCOL' });
  assert.throws(() => gate.accept(encodeEnvelope(envelope({ request: 20, terminal: 'success' }))), { code: 'ELECTRON_MBT_PROTOCOL' });
  assert.throws(() => gate.register(envelope({ request: 19 })), { code: 'ELECTRON_MBT_PROTOCOL' });
});
