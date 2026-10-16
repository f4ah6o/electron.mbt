'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { once } = require('node:events');

async function bounded(promise, ms = 10000) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('WebKit bootstrap observation timed out')), ms);
    })]);
  } finally { clearTimeout(timer); }
}

async function observedBootstrap(runtime, window) {
  for (let tries = 0; tries < 80; tries++) {
    const native = runtime.host.request('get-bootstrap-status', window.id, window._generation);
    if (native.observed === true) return native;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error('Native isolated bootstrap was not observed for the completed document');
}

test('real WebKit document-start isolated bootstrap gates trusted host handles by navigation', {
  skip: process.platform !== 'darwin' ? 'Native AppKit and WebKit required: NOT RUN' : false,
  timeout: 45000,
}, async () => {
  const { ExperimentalRuntime } = require('../bridges/node/context-runtime.cjs');
  const { inspectApp, snapshot } = require('../bridges/node/app-files.cjs');
  const app = inspectApp(path.resolve(__dirname, '../fixtures/m1-app'));
  const hash = snapshot(app.root).sha256;
  const runtime = new ExperimentalRuntime(app);
  try {
    runtime.start();
    await bounded(runtime.app.whenReady());
    const window = new runtime.BrowserWindow({ show: false });
    const isolatedEvents = [];
    runtime.host.on('isolated-preload-attested', event => isolatedEvents.push(event));
    const awaitEvent = async generation => {
      for (let attempt = 0; attempt < 100; attempt++) {
        const seen = isolatedEvents.filter(event => event.window === window.id &&
          event.generation === generation);
        if (seen.length) { assert.equal(seen.length, 1); return seen[0]; }
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      throw new Error('No native-attested isolated bootstrap event for this document');
    };
    const registry = runtime.contextHandles;
    const initial = runtime.host.request('get-bootstrap-status', window.id, 0);
    assert.deepEqual(initial, {
      observed: false, mainFrame: false, generation: 0, documentURL: '',
    });
    assert.throws(() => runtime.bootstrapScopeForTrustedHost(window, 'read-text'),
      { code: 'ELECTRON_MBT_BRIDGE_NOT_READY' });

    await bounded(window.loadFile('bootstrap.html'));
    assert.equal(window.webContents.getTitle(), 'BOOTSTRAP_HANDLER_HIDDEN',
      'The isolated native message handler must not be callable by pageWorld');
    const first = await observedBootstrap(runtime, window);
    const attestedFirst = await awaitEvent(window._generation);
    assert.ok(attestedFirst.request > 0);
    assert.equal(first.observed, true);
    assert.equal(first.mainFrame, true);
    assert.equal(first.generation, window._generation);
    assert.equal(first.documentURL, window.webContents.getURL());
    const scope = runtime.bootstrapScopeForTrustedHost(window, 'read-text');
    // The same document may grant another channel without reactivating itself.
    const extra = runtime.bootstrapScopeForTrustedHost(window, 'metadata');
    assert.equal(extra.channel, 'metadata');
    const id = registry.retainFunction(scope, () => 'from-trusted-main');
    assert.equal(registry.invoke(scope, id), 'from-trusted-main');
    assert.throws(() => registry.invoke(extra, id), { code: 'ELECTRON_MBT_Denied' });
    const waiting = registry.createPromise(scope);
    const revoked = assert.rejects(waiting.promise, { code: 'ELECTRON_MBT_BRIDGE_REVOKED' });

    const reloading = window.loadFile('bootstrap.html');
    assert.throws(() => runtime.bootstrapScopeForTrustedHost(window, 'read-text'),
      { code: 'ELECTRON_MBT_BRIDGE_NOT_READY' });
    await revoked;
    await bounded(reloading);
    await observedBootstrap(runtime, window);
    const attestedSecond = await awaitEvent(window._generation);
    assert.ok(attestedSecond.request > attestedFirst.request);
    assert.equal(isolatedEvents.filter(event => event.window === window.id).length, 2);
    assert.equal(registry.retainedCount, 0);
    assert.throws(() => registry.invoke(scope, id));
    const second = runtime.bootstrapScopeForTrustedHost(window, 'read-text');
    const current = registry.retainFunction(second, () => 'new-document');
    assert.ok(current > waiting.id);
    assert.equal(registry.invoke(second, current), 'new-document');
    assert.equal(window.webContents.getTitle(), 'BOOTSTRAP_HANDLER_HIDDEN');

    window.destroy();
    assert.equal(registry.retainedCount, 0);
    assert.throws(() => runtime.bootstrapScopeForTrustedHost(window, 'read-text'),
      { code: 'ELECTRON_MBT_BRIDGE_NOT_READY' });
    assert.equal(snapshot(app.root).sha256, hash);
    console.log(JSON.stringify({
      probe: 'contextbridge-native-bootstrap', status: 'PASS',
      isolatedHandlerHidden: true, nativeFrameDocumentObserved: true,
      isolatedNativeNotificationOneShot: true,
      sameURLReloadRevoked: true, windowDestroyRevoked: true,
      sourceHashPreserved: true, contextBridge: 'NOT_IMPLEMENTED', compatible: false,
    }));
  } finally { runtime.abort(); }
});
