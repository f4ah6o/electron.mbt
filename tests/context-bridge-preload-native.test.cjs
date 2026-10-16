'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { inspectApp, snapshot } = require('../bridges/node/app-files.cjs');

test('What: actual CJS preload runs isolated and unsupported require fails closed', {
  skip: process.platform !== 'darwin' ? 'AppKit/WKWebView is macOS-only: NOT RUN' : false,
  timeout: 60000,
}, async () => {
  const { ExperimentalRuntime } = require('../bridges/node/context-runtime.cjs');
  const app = inspectApp(path.resolve(__dirname, '../fixtures/m1-app'));
  const before = snapshot(app.root).sha256;
  const runtime = new ExperimentalRuntime(app);
  const preload = filename => ({
    show: false,
    webPreferences: {
      nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true,
      preload: path.join(app.root, filename),
    },
  });
  try {
    runtime.start();
    await runtime.app.whenReady();
    // Bypass the Node filesystem leaf to exercise the native checksum gate:
    // a failed source digest must not create any real WKWebView window.
    const reserved = JSON.parse(runtime.core.window_reserve(runtime.runtime));
    assert.equal(reserved.ok, true);
    const malformed = {
      width: 640, height: 480, title: 'tampered', show: false,
      preloadSource: 'module.exports = true;', preloadSHA256: '0'.repeat(64),
    };
    assert.throws(() => runtime.host.request('create-window', reserved.id, 0, malformed),
      { code: 'ELECTRON_MBT_WINDOW_OPTIONS' });
    assert.equal(runtime.core.window_destroy(runtime.runtime, reserved.id), true);
    assert.throws(() => new runtime.BrowserWindow(preload('../missing-preload.cjs')),
      { code: 'ELECTRON_MBT_PRELOAD_PATH_DENIED' });
    const good = new runtime.BrowserWindow(preload('isolated-preload.cjs'));
    await good.loadFile('preload-page.html');
    assert.equal(good.webContents.getTitle(), 'PRELOAD_ISOLATED');
    const scope = runtime.bootstrapScopeForTrustedHost(good, 'preload-read');
    const id = runtime.contextHandles.retainFunction(scope, () => 'host-only');
    assert.equal(runtime.contextHandles.invoke(scope, id), 'host-only');
    const slot = runtime.contextHandles.createPromise(scope);
    const expired = assert.rejects(slot.promise, { code: 'ELECTRON_MBT_BRIDGE_REVOKED' });
    await good.loadFile('preload-page.html');
    await expired;
    assert.equal(good.webContents.getTitle(), 'PRELOAD_ISOLATED');
    assert.throws(() => runtime.contextHandles.invoke(scope, id));
    const newer = runtime.bootstrapScopeForTrustedHost(good, 'preload-read');
    assert.notEqual(newer.generation, scope.generation);
    assert.equal(runtime.contextHandles.retainedCount, 0);
    good.destroy();

    const denied = new runtime.BrowserWindow(preload('unsupported-preload.cjs'));
    await assert.rejects(denied.loadFile('preload-page.html'),
      { code: 'ELECTRON_MBT_PRELOAD_UNSUPPORTED_API' });
    assert.equal(runtime.host.request('get-bootstrap-status', denied.id, denied._generation).observed, false);
    assert.throws(() => runtime.bootstrapScopeForTrustedHost(denied, 'preload-read'),
      { code: 'ELECTRON_MBT_BRIDGE_NOT_READY' });
    denied.destroy();

    // Even when an app catches the failed module import, this is not a
    // compatible preload, and must not be counted as successful execution.
    const caught = new runtime.BrowserWindow(preload('caught-require-preload.cjs'));
    await assert.rejects(caught.loadFile('preload-page.html'),
      { code: 'ELECTRON_MBT_PRELOAD_UNSUPPORTED_API' });
    assert.equal(runtime.host.request('get-bootstrap-status', caught.id, caught._generation).observed, false);
    caught.destroy();

    const broken = new runtime.BrowserWindow(preload('broken-preload.cjs'));
    await assert.rejects(broken.loadFile('preload-page.html'),
      { code: 'ELECTRON_MBT_PRELOAD_FAILED' });
    assert.throws(() => runtime.bootstrapScopeForTrustedHost(broken, 'preload-read'),
      { code: 'ELECTRON_MBT_BRIDGE_NOT_READY' });
    broken.destroy();

    assert.equal(runtime.contextHandles.retainedCount, 0);
    assert.equal(snapshot(app.root).sha256, before);
    console.log(JSON.stringify({
      probe: 'contextbridge-preload-file', status: 'PASS',
      preloadSourceUnchanged: true, isolatedWorldPrivate: true,
      nativeChecksumTamperRejected: true,
      sameURLReloadRevoked: true, requireFailsClosed: true,
      caughtUnsupportedRequireFailsClosed: true,
      syntaxFailureReported: true, compatible: false, contextBridge: 'NOT_IMPLEMENTED',
    }));
  } finally { runtime.abort(); }
});
