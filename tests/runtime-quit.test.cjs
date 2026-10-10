'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { EventEmitter } = require('node:events');

// Do not substitute this fake for the real AppKit acceptance: the macOS CJS
// fixture separately exercises the native window and actual host shutdown.
class FakeNativeHost extends EventEmitter {
  constructor() {
    super();
    this.dead = false;
    this.calls = [];
  }
  request(operation, window = 0, generation = 0) {
    if (this.dead) throw new Error('Native host has stopped');
    this.calls.push({ operation, window, generation });
    switch (operation) {
      case 'hello':
      case 'ready':
        return { backend: 'test-host' };
      case 'create-window':
        return { webViewAttached: true };
      case 'close-window':
      case 'destroy-window':
        return { destroyed: true };
      case 'cancel-close':
        return { cancelledNativeRequest: 0 };
      case 'shutdown':
        return {};
      default:
        throw new Error('Unexpected native operation: ' + operation);
    }
  }
  close() {
    this.request('shutdown');
    this.dead = true;
  }
  abort() {
    if (this.dead) return;
    this.dead = true;
    this.emit('lost', new Error('Native host aborted'));
  }
}

const nativePath = require.resolve('../bridges/node/native-host.cjs');
const sessionPath = require.resolve('../bridges/node/runtime-session.cjs');
const priorNative = require.cache[nativePath];
// Replace only the native-process leaf; run the actual MoonBit lifecycle core.
require.cache[nativePath] = { id: nativePath, filename: nativePath, loaded: true,
  exports: { NativeHost: FakeNativeHost } };
delete require.cache[sessionPath];
const { ExperimentalRuntime } = require(sessionPath);
if (priorNative) require.cache[nativePath] = priorNative;
else delete require.cache[nativePath];
delete require.cache[sessionPath];

async function readyRuntime() {
  const runtime = new ExperimentalRuntime({
    root: path.resolve(__dirname, '../fixtures/m1-app'),
    name: 'quit-test',
    version: '0.0.0',
  });
  runtime.start();
  await runtime.app.whenReady();
  return runtime;
}

test('What: app.quit preserves before-quit, window-close and will-quit cancellation', async () => {
  const runtime = await readyRuntime();
  const app = runtime.app;
  let allClosed = 0;
  let willQuit = 0;
  app.on('window-all-closed', () => allClosed++);
  app.on('will-quit', () => willQuit++);

  const normal = new runtime.BrowserWindow({ show: false });
  normal.destroy();
  assert.equal(allClosed, 1);

  const window = new runtime.BrowserWindow({ show: false });
  app.once('before-quit', event => event.preventDefault());
  app.quit();
  assert.equal(window.isDestroyed(), false);
  assert.equal(willQuit, 0);
  assert.equal(allClosed, 1);
  assert.equal(JSON.parse(runtime.core.dispatch(runtime.runtime, 'state')).state, 'Ready');

  let cancelledClose = 0;
  window.once('close', event => { cancelledClose++; event.preventDefault(); });
  app.quit();
  assert.equal(cancelledClose, 1);
  assert.equal(window.isDestroyed(), false);
  assert.equal(runtime.BrowserWindow.getAllWindows().length, 1);
  assert.equal(willQuit, 0);
  assert.equal(allClosed, 1);
  assert.equal(JSON.parse(runtime.core.dispatch(runtime.runtime, 'state')).state, 'Ready');

  app.once('will-quit', event => event.preventDefault());
  app.quit();
  assert.equal(window.isDestroyed(), true);
  assert.equal(runtime.BrowserWindow.getAllWindows().length, 0);
  assert.equal(willQuit, 1);
  assert.equal(allClosed, 1);
  assert.equal(JSON.parse(runtime.core.dispatch(runtime.runtime, 'state')).state, 'Ready');
  assert.equal(runtime.host.dead, false);

  const finalWindow = new runtime.BrowserWindow({ show: false });
  const order = [];
  app.on('before-quit', () => { order.push('before-quit'); app.quit(); });
  finalWindow.on('close', () => order.push('close'));
  finalWindow.on('closed', () => order.push('closed'));
  app.once('will-quit', () => order.push('will-quit'));
  app.once('quit', () => order.push('quit'));
  app.quit();
  assert.deepEqual(order, ['before-quit', 'close', 'closed', 'will-quit', 'quit']);
  assert.equal(finalWindow.isDestroyed(), true);
  assert.equal(runtime.host.dead, true);
  assert.equal(runtime.terminated, true);
  assert.equal(allClosed, 1);
  assert.deepEqual(runtime.host.calls.map(call => call.operation).filter(op => op === 'close-window'),
    ['close-window', 'close-window']);
});

test('What: exception in close handler cancels quit without revoking healthy native host', async () => {
  const runtime = await readyRuntime();
  const window = new runtime.BrowserWindow({ show: false });
  const expected = new Error('close handler failure');
  window.once('close', () => { throw expected; });
  assert.throws(() => runtime.app.quit(), error => error === expected);
  assert.equal(window.isDestroyed(), false);
  assert.equal(runtime.terminated, false);
  assert.equal(runtime.host.dead, false);
  assert.equal(JSON.parse(runtime.core.dispatch(runtime.runtime, 'state')).state, 'Ready');
  runtime.app.quit();
  assert.equal(window.isDestroyed(), true);
  assert.equal(runtime.terminated, true);
});
