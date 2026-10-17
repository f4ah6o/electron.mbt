'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');

class FakeNativeHost extends EventEmitter {
  constructor() { super(); this.dead = false; }
  request(operation) {
    if (this.dead) throw Object.assign(new Error('Host closed'), { code: 'ELECTRON_MBT_TRANSPORT_CLOSED' });
    if (operation === 'hello' || operation === 'ready' || operation === 'shutdown') return {};
    throw new Error('Unexpected operation ' + operation);
  }
  close() { this.dead = true; }
  abort() { this.dead = true; this.emit('lost', new Error('aborted')); }
}

const hostPath = require.resolve('../bridges/node/native-host.cjs');
const sessionPath = require.resolve('../bridges/node/runtime-session.cjs');
const previous = require.cache[hostPath];
require.cache[hostPath] = { id: hostPath, filename: hostPath, loaded: true, exports: { NativeHost: FakeNativeHost } };
delete require.cache[sessionPath];
const { ExperimentalRuntime } = require(sessionPath);
if (previous) require.cache[hostPath] = previous;
else delete require.cache[hostPath];
delete require.cache[sessionPath];

async function runtimeAt(t, root) {
  const runtime = new ExperimentalRuntime({
    root: path.resolve(__dirname, '../fixtures/m1-app'), name: 'lock-test', version: '0.0.0',
  }, { userDataRoot: root });
  runtime.start();
  await runtime.app.whenReady();
  t.after(() => runtime.abort());
  return runtime;
}

test('M1 single-instance lock is exclusive and release allows a new owner', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'electron-mbt-lock-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const first = await runtimeAt(t, root);
  const second = await runtimeAt(t, root);
  assert.equal(first.app.requestSingleInstanceLock(), true);
  assert.equal(second.app.requestSingleInstanceLock(), false);
  first.app.releaseSingleInstanceLock();
  assert.equal(second.app.requestSingleInstanceLock(), true);
  second.app.releaseSingleInstanceLock();
  assert.equal(second.app.requestSingleInstanceLock(), true);
  second.app.releaseSingleInstanceLock();
  second.app.quit();
  first.app.quit();
});

test('a stale lock owned by a dead process is reclaimed', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'electron-mbt-lock-stale-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'single-instance.lock'), '999999');
  const runtime = await runtimeAt(t, root);
  assert.equal(runtime.app.requestSingleInstanceLock(), true);
  runtime.app.releaseSingleInstanceLock();
  assert.equal(fs.existsSync(path.join(root, 'single-instance.lock')), false);
  runtime.app.quit();
});
