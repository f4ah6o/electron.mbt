'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { EventEmitter } = require('node:events');

class FakeNativeHost extends EventEmitter {
  constructor() {
    super();
    this.dead = false;
    this.titles = new Map();
    this.wrongSetAck = false;
    this.wrongGetAck = false;
  }
  request(operation, window = 0, generation = 0, payload = {}) {
    if (this.dead) throw Object.assign(new Error('Host closed'), { code: 'ELECTRON_MBT_TRANSPORT_CLOSED' });
    switch (operation) {
      case 'hello': case 'ready':
        return { backend: 'test-host' };
      case 'create-window':
        this.titles.set(window, payload.title);
        return { webViewAttached: true };
      case 'get-window-title':
        return { title: this.wrongGetAck ? 12 : this.titles.get(window) };
      case 'set-window-title':
        this.titles.set(window, payload.title);
        return { title: this.wrongSetAck ? 'forged' : payload.title };
      case 'close-window': case 'destroy-window':
        this.titles.delete(window);
        return { destroyed: true };
      case 'cancel-close':
        return { cancelledNativeRequest: 0 };
      case 'shutdown':
        return {};
      default:
        throw new Error('Unexpected operation ' + operation);
    }
  }
  close() { this.dead = true; }
  abort() {
    if (this.dead) return;
    this.dead = true;
    this.emit('lost', new Error('Host aborted'));
  }
}

const nativePath = require.resolve('../bridges/node/native-host.cjs');
const sessionPath = require.resolve('../bridges/node/runtime-session.cjs');
const prior = require.cache[nativePath];
require.cache[nativePath] = { id: nativePath, filename: nativePath, loaded: true,
  exports: { NativeHost: FakeNativeHost } };
delete require.cache[sessionPath];
const { ExperimentalRuntime } = require(sessionPath);
if (prior) require.cache[nativePath] = prior;
else delete require.cache[nativePath];
delete require.cache[sessionPath];

async function readyRuntime() {
  const runtime = new ExperimentalRuntime({
    root: path.resolve(__dirname, '../fixtures/m1-app'),
    name: 'title-test', version: '0.0.0',
  });
  runtime.start();
  await runtime.app.whenReady();
  return runtime;
}

test('What: native title reads and writes preserve synchronous values, validation and destruction', async () => {
  const runtime = await readyRuntime();
  const window = new runtime.BrowserWindow({ title: 'initial', show: false });
  assert.equal(window.getTitle(), 'initial');
  assert.equal(window.setTitle('title 日本語'), undefined);
  assert.equal(window.getTitle(), 'title 日本語');
  for (const value of [undefined, 15, 'x'.repeat(257)]) {
    assert.throws(() => window.setTitle(value), { code: 'ELECTRON_MBT_INVALID_ARGUMENT' });
  }
  assert.equal(window.getTitle(), 'title 日本語');
  window.destroy();
  assert.throws(() => window.getTitle(), { code: 'ELECTRON_MBT_WINDOW_DESTROYED' });
  assert.throws(() => window.setTitle('later'), { code: 'ELECTRON_MBT_WINDOW_DESTROYED' });
  runtime.app.quit();
  assert.equal(runtime.terminated, true);
});

test('What: mismatched set-title native success poisons the runtime', async () => {
  const runtime = await readyRuntime();
  const window = new runtime.BrowserWindow({ title: 'initial', show: false });
  runtime.host.wrongSetAck = true;
  assert.throws(() => window.setTitle('expected'), { code: 'ELECTRON_MBT_PROTOCOL' });
  assert.equal(runtime.terminated, true);
  assert.equal(runtime.host.dead, true);
  assert.equal(window.isDestroyed(), true);
});

test('What: malformed get-title native success fails closed before reaching the application', async () => {
  const runtime = await readyRuntime();
  const window = new runtime.BrowserWindow({ title: 'initial', show: false });
  runtime.host.wrongGetAck = true;
  assert.throws(() => window.getTitle(), { code: 'ELECTRON_MBT_PROTOCOL' });
  assert.equal(runtime.terminated, true);
  assert.equal(runtime.host.dead, true);
  assert.equal(window.isDestroyed(), true);
});
