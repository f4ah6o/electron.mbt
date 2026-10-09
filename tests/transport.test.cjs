'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawn } = require('node:child_process');
const addon = require('../dist/sync_channel.node');
const decoder = new TextDecoder('utf-8', { fatal: true });
function host(t, mode) {
  const [parent, child] = addon.pair();
  const processHandle = spawn(process.execPath, [path.join(__dirname, 'channel-host.cjs'), mode], {
    stdio: ['ignore', 'ignore', 'ignore', child],
  });
  addon.close(child);
  t.after(async () => {
    addon.close(parent);
    if (processHandle.exitCode === null && processHandle.signalCode === null) processHandle.kill('SIGKILL');
    if (processHandle.exitCode === null && processHandle.signalCode === null) {
      await new Promise(resolve => processHandle.once('exit', resolve));
    }
  });
  return parent;
}
test('synchronous request returns values without pumping the JS event loop', t => {
  const fd = host(t, 'echo');
  let ticked = false;
  queueMicrotask(() => { ticked = true; });
  const value = '{"text":"日本語","id":1}';
  assert.equal(decoder.decode(addon.request(fd, value, 2000)), value);
  assert.equal(ticked, false);
  assert.equal(decoder.decode(addon.request(fd, '{"id":2}', 2000)), '{"id":2}');
});
test('watchdog failure poisons the channel instead of consuming a late reply', t => {
  const fd = host(t, 'stall');
  assert.throws(() => addon.request(fd, '{}', 200), { code: 'ELECTRON_MBT_TRANSPORT_TIMEOUT' });
  assert.throws(() => addon.request(fd, '{}', 200), { code: 'ELECTRON_MBT_TRANSPORT_CLOSED' });
});
for (const mode of ['crash', 'truncated']) {
  test(`${mode} terminates the control call with a typed failure`, t => {
    const fd = host(t, mode);
    assert.throws(() => addon.request(fd, '{}', 2000), { code: 'ELECTRON_MBT_TRANSPORT_CLOSED' });
  });
}
test('oversized replies are rejected before allocation', t => {
  const fd = host(t, 'oversized');
  assert.throws(() => addon.request(fd, '{}', 2000), { code: 'ELECTRON_MBT_LIMIT' });
});
test('outbound limit uses encoded bytes rather than UTF-16 length', t => {
  const fd = host(t, 'echo');
  assert.throws(() => addon.request(fd, 'あ'.repeat(350000), 1000), { code: 'ELECTRON_MBT_LIMIT' });
  assert.equal(decoder.decode(addon.request(fd, '{}', 2000)), '{}');
});
test('invalid UTF-8 is not silently replaced in replies', t => {
  const fd = host(t, 'invalid-utf8');
  assert.throws(() => decoder.decode(addon.request(fd, '{}', 2000)), TypeError);
});
test('invalid watchdog values fail before transport side effects', t => {
  const fd = host(t, 'echo');
  for (const value of [0, -1, 1.5, NaN, Infinity, 60001]) {
    assert.throws(() => addon.request(fd, '{}', value), { code: 'ELECTRON_MBT_INVALID_ARGUMENT' });
  }
});

test('a blocking endpoint is rejected before a watchdog can be bypassed', () => {
  const [parent, child] = addon.pair();
  try { assert.throws(() => addon.request(child, 'x', 100), { code: 'ELECTRON_MBT_INVALID_ARGUMENT' }); }
  finally { addon.close(parent); addon.close(child); }
});
