'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { EventEmitter } = require('node:events');

class FakeNativeHost extends EventEmitter {
  constructor() {
    super();
    this.dead = false;
    this.bounds = new Map();
    this.badAck = null;
  }
  request(operation, window = 0, generation = 0, payload = {}) {
    if (this.dead) throw Object.assign(new Error('Host closed'), { code: 'ELECTRON_MBT_TRANSPORT_CLOSED' });
    switch (operation) {
      case 'hello': case 'ready': return {};
      case 'create-window':
        this.bounds.set(window, { x: -12, y: 33, width: payload.width, height: payload.height + 24 });
        return { webViewAttached: true };
      case 'get-window-bounds': return this.badAck ?? { ...this.bounds.get(window) };
      case 'destroy-window': case 'close-window':
        this.bounds.delete(window);
        return { destroyed: true };
      case 'cancel-close': return { cancelledNativeRequest: 0 };
      case 'shutdown': return { closed: true };
      default: throw new Error('Unexpected operation ' + operation);
    }
  }
  close() { this.dead = true; }
  abort() {
    if (this.dead) return;
    this.dead = true;
    this.emit('lost', new Error('Host aborted'));
  }
}

const hostPath = require.resolve('../bridges/node/native-host.cjs');
const runtimePath = require.resolve('../bridges/node/runtime-session.cjs');
const previous = require.cache[hostPath];
require.cache[hostPath] = { id: hostPath, filename: hostPath, loaded: true,
  exports: { NativeHost: FakeNativeHost } };
delete require.cache[runtimePath];
const { ExperimentalRuntime } = require(runtimePath);
if (previous) require.cache[hostPath] = previous;
else delete require.cache[hostPath];
delete require.cache[runtimePath];

async function readyRuntime() {
  const runtime = new ExperimentalRuntime({
    root: path.resolve(__dirname, '../fixtures/m1-app'),
    name: 'bounds-test', version: '0.0.0',
  });
  runtime.start();
  await runtime.app.whenReady();
  return runtime;
}

test('What: getBounds synchronously reflects native frame changes and denies destroyed windows', async () => {
  const runtime = await readyRuntime();
  const win = new runtime.BrowserWindow({ width: 640, height: 480, show: false });
  assert.deepEqual(win.getBounds(), { x: -12, y: 33, width: 640, height: 504 });
  runtime.host.bounds.get(win.id).x = 120;
  assert.deepEqual(win.getBounds(), { x: 120, y: 33, width: 640, height: 504 });
  win.once('closed', () => {
    assert.throws(() => win.getBounds(), { code: 'ELECTRON_MBT_WINDOW_DESTROYED' });
  });
  win.destroy();
  assert.throws(() => win.getBounds(), { code: 'ELECTRON_MBT_WINDOW_DESTROYED' });
  runtime.app.quit();
  assert.equal(runtime.terminated, true);
});

test('What: malformed native getBounds ACK fails closed without exposing a forged value', async () => {
  for (const malformed of [
    {}, { x: 1, y: 2, width: 0, height: 500 },
    { x: 1.25, y: 2, width: 640, height: 500 },
    { x: 1, y: 2, width: 640, height: 500, extra: true },
  ]) {
    const runtime = await readyRuntime();
    const win = new runtime.BrowserWindow({ show: false });
    runtime.host.badAck = malformed;
    assert.throws(() => win.getBounds(), { code: 'ELECTRON_MBT_PROTOCOL' });
    assert.equal(runtime.host.dead, true);
    assert.equal(runtime.terminated, true);
    assert.equal(win.isDestroyed(), true);
  }
});
