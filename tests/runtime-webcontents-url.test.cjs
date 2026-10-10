'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { EventEmitter } = require('node:events');

class FakeNativeHost extends EventEmitter {
  constructor() {
    super();
    this.dead = false;
    this.urls = new Map();
    this.malformedURL = false;
  }
  request(operation, window = 0, generation = 0, payload = {}) {
    if (this.dead) throw Object.assign(new Error('Host closed'), { code: 'ELECTRON_MBT_TRANSPORT_CLOSED' });
    switch (operation) {
      case 'hello': case 'ready': return {};
      case 'create-window': this.urls.set(window, ''); return { webViewAttached: true };
      case 'begin-load': this.urls.set(window, ''); return { generation };
      case 'get-web-contents-url': return { url: this.malformedURL ? { forged: true } : this.urls.get(window) };
      case 'close-window': case 'destroy-window': this.urls.delete(window); return { destroyed: true };
      case 'cancel-close': return { cancelledNativeRequest: 0 };
      case 'shutdown': return {};
      default: throw new Error('Unexpected operation: ' + operation);
    }
  }
  requestAsync(operation, window, generation, payload) {
    if (operation !== 'load-file') return Promise.reject(new Error('Unexpected async operation'));
    this.urls.set(window, pathToFileURL(payload.file).href);
    return Promise.resolve({ didFinishLoad: true });
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
    name: 'url-test', version: '0.0.0',
  });
  runtime.start();
  await runtime.app.whenReady();
  return runtime;
}

test('What: webContents.getURL synchronously reads native state and rejects destroyed windows', async () => {
  const runtime = await readyRuntime();
  const win = new runtime.BrowserWindow({ show: false });
  assert.equal(win.webContents.getURL(), '');
  await win.loadFile('index.html');
  assert.equal(win.webContents.getURL(),
    pathToFileURL(path.resolve(__dirname, '../fixtures/m1-app/index.html')).href);
  win.once('closed', () => {
    assert.throws(() => win.webContents.getURL(), { code: 'ELECTRON_MBT_WINDOW_DESTROYED' });
  });
  win.destroy();
  assert.throws(() => win.webContents.getURL(), { code: 'ELECTRON_MBT_WINDOW_DESTROYED' });
  runtime.app.quit();
  assert.equal(runtime.terminated, true);
});

test('What: malformed native URL success fails closed instead of exposing forged state', async () => {
  const runtime = await readyRuntime();
  const win = new runtime.BrowserWindow({ show: false });
  runtime.host.malformedURL = true;
  assert.throws(() => win.webContents.getURL(), { code: 'ELECTRON_MBT_PROTOCOL' });
  assert.equal(runtime.host.dead, true);
  assert.equal(runtime.terminated, true);
  assert.equal(win.isDestroyed(), true);
});

test('What: terminated WebKit content cannot be reported as a live URL', async () => {
  const runtime = await readyRuntime();
  const win = new runtime.BrowserWindow({ show: false });
  win._renderProcessGone = true;
  assert.throws(() => win.webContents.getURL(), { code: 'ELECTRON_MBT_WEB_PROCESS_TERMINATED' });
  assert.equal(runtime.host.dead, false);
  win.destroy();
  runtime.app.quit();
});
