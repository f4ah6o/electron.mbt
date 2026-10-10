'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const { NativeHost } = require('../bridges/node/native-host.cjs');

async function waitForExit(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise((resolve, reject) => {
    const deadline = setTimeout(() => reject(new Error('Native child did not exit')), 4000);
    child.once('exit', () => { clearTimeout(deadline); resolve(); });
  });
}
async function main() {
  if (process.platform !== 'darwin') throw new Error('macOS native raw-frame test required');
  const root = path.resolve(__dirname, '../fixtures/m1');
  const badFields = [
    ['"request":2', '"request":2.00000000000000001'],
    ['"request":2', '"request":9007199254740992'],
    ['"window":0', '"window":0.5'],
    ['"generation":0', '"generation":0.5'],
    ['"version":1', '"version":1.00000000000000001'],
  ];
  for (const [original, replacement] of badFields) {
    const host = new NativeHost(root, { watchdogMs: 4000 });
    try {
      host.request('hello');
      const valid = JSON.stringify({
        version: 1, session: host.session, request: 2, window: 0,
        generation: 0, operation: 'shutdown', payload: {},
      });
      assert.ok(valid.includes(original));
      const raw = valid.replace(original, replacement);
      assert.throws(() => host.addon.request(host.fd, raw, 4000),
        { code: 'ELECTRON_MBT_TRANSPORT_CLOSED' });
    } finally {
      host.abort();
      await waitForExit(host.process);
    }
  }
  console.log(JSON.stringify({
    probe: 'm1-native-raw-identity-validation', status: 'PASS',
    rejectedMalformedIdentifiers: badFields.length, untrustedFramesRejectedBeforeDispatch: true,
    compatible: false,
  }));
}
main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
