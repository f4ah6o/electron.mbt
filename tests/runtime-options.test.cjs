'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');

class FakeNativeHost extends EventEmitter {
  constructor() {
    super();
    this.dead = false;
    this.created = null;
    this.bounds = null;
    this.minimum = [0, 0];
    this.background = '#ffffff';
  }
  request(operation, window = 0, generation = 0, payload = {}) {
    if (this.dead) throw Object.assign(new Error('Host closed'), { code: 'ELECTRON_MBT_TRANSPORT_CLOSED' });
    switch (operation) {
      case 'hello': case 'ready': return {};
      case 'create-window':
        this.created = { ...payload };
        this.bounds = { x: 0, y: 0, width: payload.width, height: payload.height };
        return { webViewAttached: true };
      case 'set-window-bounds':
        Object.assign(this.bounds, payload);
        return { ...this.bounds };
      case 'get-window-min-size': return { width: this.minimum[0], height: this.minimum[1] };
      case 'set-window-min-size':
        this.minimum = [payload.width, payload.height];
        return { width: this.minimum[0], height: this.minimum[1] };
      case 'get-window-background-color': return { color: this.background };
      case 'set-window-background-color':
        this.background = payload.color;
        return { color: this.background };
      case 'destroy-window': case 'close-window': return { destroyed: true };
      case 'cancel-close': return { cancelledNativeRequest: 0 };
      case 'shutdown': return { closed: true };
      default: throw new Error('Unexpected operation ' + operation);
    }
  }
  close() { this.dead = true; }
  abort() { if (!this.dead) { this.dead = true; this.emit('lost', new Error('aborted')); } }
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

async function readyRuntime(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'electron-mbt-options-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const runtime = new ExperimentalRuntime({
    root: path.resolve(__dirname, '../fixtures/m1-app'), name: 'options-test', version: '0.0.0',
  }, { userDataRoot: root });
  runtime.start();
  await runtime.app.whenReady();
  return runtime;
}

test('BrowserWindow options apply position, minimum size and background colour', async (t) => {
  const runtime = await readyRuntime(t);
  const window = new runtime.BrowserWindow({
    width: 640, height: 480, x: -12, y: 33,
    minWidth: 320, minHeight: 240, backgroundColor: '#112233',
    autoHideMenuBar: true, icon: path.resolve(__dirname, '../fixtures/m1-app/index.html'),
    show: false,
  });
  assert.deepEqual(runtime.host.created, { width: 640, height: 480, title: '', show: false });
  assert.deepEqual(runtime.host.bounds, { x: -12, y: 33, width: 640, height: 480 });
  assert.deepEqual(window.getMinimumSize(), [320, 240]);
  assert.equal(window.getBackgroundColor(), '#112233');
  window.setMinimumSize(400, 300);
  assert.deepEqual(window.getMinimumSize(), [400, 300]);
  window.setBackgroundColor('#abcdef');
  assert.equal(window.getBackgroundColor(), '#abcdef');
  assert.equal(window.webContents.setWindowOpenHandler(() => ({ action: 'deny' })), undefined);
  assert.throws(() => window.webContents.setWindowOpenHandler(null), { code: 'ELECTRON_MBT_INVALID_ARGUMENT' });
  window.destroy();
  runtime.app.quit();
});

test('BrowserWindow rejects invalid or unsupported options before native creation', async (t) => {
  const runtime = await readyRuntime(t);
  const invalid = [
    { minWidth: -1 }, { minHeight: 4097 }, { backgroundColor: 'red' },
    { autoHideMenuBar: 'yes' }, { icon: path.resolve(__dirname, 'runtime-options.test.cjs') },
  ];
  for (const options of invalid) {
    assert.throws(() => new runtime.BrowserWindow(options), { code: options.icon ? 'ELECTRON_MBT_FILE_DENIED' : 'ELECTRON_MBT_UNSUPPORTED_API' });
  }
  assert.equal(runtime.host.created, null);
  runtime.app.quit();
});
