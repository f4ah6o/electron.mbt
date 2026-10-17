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
    this.failOn = null;
    this.loseOnShutdown = false;
  }
  request(operation, window = 0, generation = 0) {
    if (this.dead) throw new Error('Native host has stopped');
    this.calls.push({ operation, window, generation });
    if (this.failOn === operation) {
      this.failOn = null;
      this.abort();
      throw Object.assign(new Error('Native transport lost during ' + operation),
        { code: 'ELECTRON_MBT_TRANSPORT_CLOSED' });
    }
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
    if (this.loseOnShutdown) {
      this.abort();
      return;
    }
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
  let observedQuitArguments = false;
  app.once('quit', (event, exitCode) => {
    assert.equal(typeof event, 'object');
    assert.equal(typeof event.preventDefault, 'function');
    assert.equal(exitCode, 0);
    observedQuitArguments = true;
    order.push('quit');
  });
  app.quit();
  assert.equal(observedQuitArguments, true);
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

test('What: caught native transport error during close does not produce will-quit or quit', async () => {
  const runtime = await readyRuntime();
  const window = new runtime.BrowserWindow({ show: false });
  const events = [];
  runtime.app.on('before-quit', () => events.push('before-quit'));
  runtime.app.on('will-quit', () => events.push('will-quit'));
  runtime.app.on('quit', () => events.push('quit'));
  runtime.app.on('runtime-host-gone', () => events.push('runtime-host-gone'));
  window.once('close', () => {
    events.push('close');
    runtime.host.failOn = 'show-window';
    assert.throws(() => window.show(), { code: 'ELECTRON_MBT_TRANSPORT_CLOSED' });
    assert.equal(window.isDestroyed(), true);
  });

  runtime.app.quit();
  assert.deepEqual(events, ['before-quit', 'close', 'runtime-host-gone']);
  assert.equal(runtime.terminated, true);
  assert.equal(runtime.host.dead, true);
  assert.equal(runtime.app.isReady(), false);
  assert.equal(runtime.BrowserWindow.getAllWindows().length, 0);
  assert.equal(JSON.parse(runtime.core.dispatch(runtime.runtime, 'state')).state, 'Stopped');
  assert.equal(runtime.host.calls.some(call => call.operation === 'close-window'), false);
  assert.equal(runtime.host.calls.some(call => call.operation === 'shutdown'), false);
  runtime.app.quit();
  assert.deepEqual(events, ['before-quit', 'close', 'runtime-host-gone']);
});

test('What: host loss in before-quit stops the transition before native window close', async () => {
  const runtime = await readyRuntime();
  const window = new runtime.BrowserWindow({ show: false });
  const events = [];
  runtime.app.on('before-quit', () => {
    events.push('before-quit');
    runtime.host.abort();
  });
  window.on('close', () => events.push('close'));
  runtime.app.on('runtime-host-gone', () => events.push('runtime-host-gone'));
  runtime.app.on('will-quit', () => events.push('will-quit'));
  runtime.app.on('quit', () => events.push('quit'));
  runtime.app.quit();
  assert.deepEqual(events, ['before-quit', 'runtime-host-gone']);
  assert.equal(runtime.terminated, true);
  assert.equal(window.isDestroyed(), true);
});

test('What: host loss during will-quit prevents the final quit event', async () => {
  const runtime = await readyRuntime();
  const window = new runtime.BrowserWindow({ show: false });
  const events = [];
  runtime.app.on('before-quit', () => events.push('before-quit'));
  window.on('close', () => events.push('close'));
  window.on('closed', () => events.push('closed'));
  runtime.app.on('will-quit', () => {
    events.push('will-quit');
    runtime.host.abort();
  });
  runtime.app.on('runtime-host-gone', () => events.push('runtime-host-gone'));
  runtime.app.on('quit', () => events.push('quit'));
  runtime.app.quit();
  assert.deepEqual(events, [
    'before-quit', 'close', 'closed', 'will-quit', 'runtime-host-gone',
  ]);
  assert.equal(window.isDestroyed(), true);
  assert.equal(runtime.terminated, true);
  assert.equal(runtime.host.calls.some(call => call.operation === 'shutdown'), false);
});

test('What: host loss while acknowledging shutdown cannot emit a normal quit event', async () => {
  const runtime = await readyRuntime();
  const window = new runtime.BrowserWindow({ show: false });
  const events = [];
  runtime.host.loseOnShutdown = true;
  runtime.app.on('runtime-host-gone', () => events.push('runtime-host-gone'));
  runtime.app.on('will-quit', () => events.push('will-quit'));
  runtime.app.on('quit', () => events.push('quit'));
  runtime.app.quit();
  assert.deepEqual(events, ['will-quit', 'runtime-host-gone']);
  assert.equal(window.isDestroyed(), true);
  assert.equal(runtime.terminated, true);
  assert.equal(runtime.host.calls.filter(call => call.operation === 'shutdown').length, 1);
});
