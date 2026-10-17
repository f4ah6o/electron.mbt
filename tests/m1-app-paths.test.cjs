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

async function readyRuntime(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'electron-mbt-paths-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const runtime = new ExperimentalRuntime({
    root: path.resolve(__dirname, '../fixtures/m1-app'), name: 'paths-test', version: '0.0.0',
  }, { userDataRoot: root });
  runtime.start();
  await runtime.app.whenReady();
  return { runtime, root };
}

test('M1 app paths stay under an isolated root and support setName/getPath/setPath', async (t) => {
  const { runtime, root } = await readyRuntime(t);
  const { app } = runtime;
  assert.equal(app.isPackaged, false);
  assert.equal(typeof app.getLocale(), 'string');
  assert.equal(app.setName('Moji'), undefined);
  assert.equal(app.getName(), 'Moji');
  assert.equal(app.name, 'Moji');
  assert.throws(() => app.setName(''), { code: 'ELECTRON_MBT_INVALID_ARGUMENT' });
  const appData = app.getPath('appData');
  assert.equal(appData, path.join(root, 'appData'));
  const target = path.join(appData, 'moji');
  app.setPath('userData', target);
  assert.equal(app.getPath('userData'), target);
  assert.equal(fs.statSync(target).isDirectory(), true);
  assert.ok(app.getPath('documents').startsWith(root + path.sep));
  assert.ok(path.isAbsolute(app.getPath('exe')));
  app.quit();
});

test('M1 app path escape and unsupported APIs fail closed', async (t) => {
  const { runtime, root } = await readyRuntime(t);
  const { app } = runtime;
  assert.throws(() => app.getPath('bogus'), { code: 'ELECTRON_MBT_INVALID_ARGUMENT' });
  assert.throws(() => app.setPath('appData', path.join(root, 'appData')), { code: 'ELECTRON_MBT_INVALID_ARGUMENT' });
  assert.throws(() => app.setPath('userData', path.join(root, '..', 'escape')), { code: 'ELECTRON_MBT_FILE_DENIED' });
  assert.throws(() => app.setPath('userData', 'relative/path'), { code: 'ELECTRON_MBT_INVALID_ARGUMENT' });
  assert.throws(() => app.requestSingleInstanceLock(), { code: 'ELECTRON_MBT_UNSUPPORTED_API' });
  app.quit();
});
