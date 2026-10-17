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
const contextPath = require.resolve('../bridges/node/context-runtime.cjs');
const previous = require.cache[hostPath];
require.cache[hostPath] = { id: hostPath, filename: hostPath, loaded: true, exports: { NativeHost: FakeNativeHost } };
delete require.cache[contextPath];
const { ExperimentalRuntime } = require(contextPath);
if (previous) require.cache[hostPath] = previous;
else delete require.cache[hostPath];
delete require.cache[contextPath];

test('M1 exposes the main-local ipcMain registration surface', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'electron-mbt-ipc-main-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const runtime = new ExperimentalRuntime({
    root: path.resolve(__dirname, '../fixtures/m1-app'), name: 'ipc-test', version: '0.0.0',
  }, { userDataRoot: root });
  runtime.start();
  await runtime.app.whenReady();
  const { ipcMain } = runtime;
  assert.equal(typeof ipcMain.handle, 'function');
  assert.equal(typeof ipcMain.on, 'function');
  assert.equal(typeof ipcMain.emit, 'function');
  ipcMain.handle('fixture:echo', () => 42);
  ipcMain.removeHandler('fixture:echo');
  let observed = 0;
  ipcMain.on('fixture:event', value => { observed = value; });
  assert.equal(ipcMain.emit('fixture:event', 7), true);
  assert.equal(observed, 7);
  assert.equal(ipcMain.listenerCount('fixture:event'), 1);
  ipcMain.removeAllListeners('fixture:event');
  assert.equal(ipcMain.listenerCount('fixture:event'), 0);
  runtime.app.quit();
});
