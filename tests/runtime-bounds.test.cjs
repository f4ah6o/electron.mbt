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
        this.bounds.set(window, { x: -12, y: 33, width: payload.width, height: payload.height });
        return { webViewAttached: true };
      case 'get-window-bounds': return this.badAck ?? { ...this.bounds.get(window) };
      case 'set-window-bounds':
        Object.assign(this.bounds.get(window), payload);
        return this.badAck ?? { ...this.bounds.get(window) };
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
  assert.deepEqual(win.getBounds(), { x: -12, y: 33, width: 640, height: 480 });
  runtime.host.bounds.get(win.id).x = 120;
  assert.deepEqual(win.getBounds(), { x: 120, y: 33, width: 640, height: 480 });
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

test('What: partial setBounds updates native-owned geometry and returns undefined synchronously', async () => {
  const runtime = await readyRuntime();
  const win = new runtime.BrowserWindow({ width: 640, height: 480, show: false });
  assert.equal(win.setBounds({ width: 800 }), undefined);
  assert.deepEqual(win.getBounds(), { x: -12, y: 33, width: 800, height: 480 });
  assert.equal(win.setBounds({ x: 100, y: 120, height: 540 }, false), undefined);
  assert.deepEqual(win.getBounds(), { x: 100, y: 120, width: 800, height: 540 });
  assert.equal(win.setBounds({}), undefined);
  assert.deepEqual(win.getBounds(), { x: 100, y: 120, width: 800, height: 540 });
  win.destroy();
  assert.throws(() => win.setBounds({ x: 20 }), { code: 'ELECTRON_MBT_WINDOW_DESTROYED' });
  runtime.app.quit();
  assert.equal(runtime.terminated, true);
});

test('What: unsafe or invalid setBounds arguments do not invalidate otherwise healthy windows', async () => {
  const runtime = await readyRuntime();
  const win = new runtime.BrowserWindow({ width: 640, height: 480, show: false });
  let accessorCalls = 0;
  const getter = Object.defineProperty({}, 'width', {
    enumerable: true, get() { accessorCalls++; return 800; },
  });
  const proxy = new Proxy({}, {
    ownKeys() { accessorCalls++; return ['width']; },
    getPrototypeOf() { accessorCalls++; return Object.prototype; },
  });
  const inherited = Object.create({ width: 640 });
  for (const bounds of [null, 45, [], getter, proxy, inherited, { size: 10 },
    { x: 1.5 }, { x: -0 }, { y: 1048577 }, { width: 99 }, { height: 4097 },
    { width: Infinity }, { width: '900' }, { height: false }, { width: undefined },
    { [Symbol('hidden')]: 1 }]) {
    assert.throws(() => win.setBounds(bounds), { code: 'ELECTRON_MBT_INVALID_ARGUMENT' });
    assert.equal(runtime.host.dead, false);
    assert.equal(runtime.app.isReady(), true);
    assert.equal(win.isDestroyed(), false);
  }
  assert.equal(accessorCalls, 0);
  assert.throws(() => win.setBounds({ width: 750 }, true), { code: 'ELECTRON_MBT_UNSUPPORTED_API' });
  assert.throws(() => win.setBounds({ width: 750 }, 1), { code: 'ELECTRON_MBT_UNSUPPORTED_API' });
  assert.deepEqual(win.getBounds(), { x: -12, y: 33, width: 640, height: 480 });
  assert.equal(win.setBounds({ width: 750 }), undefined);
  assert.equal(win.getBounds().width, 750);
  win.destroy();
  runtime.app.quit();
});

test('What: malformed native setBounds success ACK aborts without accepting forged geometry', async () => {
  for (const reply of [{}, { x: 1, y: 2, width: 0, height: 500 },
    { x: 1, y: 2, width: 640, height: 500, extra: 1 },
    { x: 1.5, y: 2, width: 640, height: 500 }]) {
    const runtime = await readyRuntime();
    const win = new runtime.BrowserWindow({ show: false });
    runtime.host.badAck = reply;
    assert.throws(() => win.setBounds({ width: 750 }), { code: 'ELECTRON_MBT_PROTOCOL' });
    assert.equal(runtime.host.dead, true);
    assert.equal(runtime.terminated, true);
    assert.equal(win.isDestroyed(), true);
  }
});
