'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { once } = require('node:events');

async function deadline(promise) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('Native context registry observation timed out')), 10000);
    })]);
  } finally { clearTimeout(timer); }
}

test('real native navigation destruction and host loss reclaim the connected JS registry', {
  skip: process.platform !== 'darwin' ? 'AppKit/WKWebView requires macOS; NOT RUN on this platform' : false,
  timeout: 45000,
}, async () => {
  const { ExperimentalRuntime } = require('../bridges/node/context-runtime.cjs');
  const { inspectApp, snapshot } = require('../bridges/node/app-files.cjs');
  const app = inspectApp(path.resolve(__dirname, '../fixtures/m1-app'));
  const before = snapshot(app.root).sha256;
  const runtime = new ExperimentalRuntime(app);
  const registry = runtime.contextHandles;
  function install(window) {
    // This trusted host fixture is not renderer/frame initiator attestation.
    const scope = { window: String(window.id), generation: String(window._generation),
      origin: window.webContents.getURL(), mainFrame: true, channel: 'test-closure' };
    for (const request of [
      { op: 'activate', window: scope.window, generation: scope.generation, origin: scope.origin },
      { op: 'grant', window: scope.window, generation: scope.generation, channel: scope.channel },
    ]) {
      const reply = JSON.parse(runtime.core.context_bridge_dispatch(runtime.runtime, JSON.stringify(request)));
      assert.equal(reply.ok, true, JSON.stringify(reply));
    }
    const id = registry.retainFunction(scope, () => 'host-local');
    assert.equal(registry.invoke(scope, id), 'host-local');
    const pending = registry.createPromise(scope);
    const rejected = assert.rejects(pending.promise, { code: 'ELECTRON_MBT_BRIDGE_REVOKED' });
    return { scope, id, pending, rejected };
  }
  try {
    runtime.start();
    await deadline(runtime.app.whenReady());
    const window = new runtime.BrowserWindow({ show: false });
    await window.loadFile('index.html');
    const first = install(window);
    const load = window.loadFile('index.html');
    await first.rejected;
    await load;
    assert.equal(registry.retainedCount, 0);
    assert.throws(() => registry.invoke(first.scope, first.id));
    const second = install(window);
    let closed = false;
    window.once('closed', () => { closed = true; assert.equal(registry.retainedCount, 0); });
    window.destroy();
    await second.rejected;
    assert.equal(closed, true);
    const lostWindow = new runtime.BrowserWindow({ show: false });
    await lostWindow.loadFile('index.html');
    const third = install(lostWindow);
    let lostClosed = false;
    lostWindow.on('closed', () => { lostClosed = true; });
    const lost = once(runtime.app, 'runtime-host-gone');
    assert.equal(runtime.host.process.kill('SIGKILL'), true);
    await deadline(lost);
    await third.rejected;
    assert.equal(registry.retainedCount, 0);
    assert.equal(runtime.core.context_bridge_count(runtime.runtime), 0);
    assert.equal(runtime.terminated, true);
    assert.equal(lostClosed, false);
    assert.equal(snapshot(app.root).sha256, before);
    console.log(JSON.stringify({ probe: 'contextbridge-native-lifetime', status: 'PASS',
      nativeNavigationCleanup: true, nativeDestroyCleanup: true, killedHostCleanup: true,
      sourceHashPreserved: true, contextBridge: 'NOT_IMPLEMENTED', compatible: false }));
  } finally { runtime.abort(); }
});
