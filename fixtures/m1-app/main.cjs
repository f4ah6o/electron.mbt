'use strict';
const assert = require('node:assert/strict');
const { app, BrowserWindow } = require('electron');
const dependencyFacade = require('./dependency/index.cjs');
assert.equal(dependencyFacade.app, app);
assert.equal(dependencyFacade.BrowserWindow, BrowserWindow);
assert.equal(app.isReady(), false);
assert.throws(() => new BrowserWindow({ show: false }), { code: 'ELECTRON_MBT_INVALID_STATE' });
let readyEvents = 0;
app.on('ready', () => { readyEvents++; });
app.whenReady().then(async () => {
  assert.equal(readyEvents, 1);
  assert.equal(app.isReady(), true);
  const win = new BrowserWindow({
    width: 640, height: 480, title: 'M1 CJS fixture', show: false,
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true },
  });
  assert.equal(BrowserWindow.getAllWindows()[0], win);
  assert.throws(() => win.getBounds(), { code: 'ELECTRON_MBT_UNSUPPORTED_API' });
  assert.throws(() => win.webContents.send('danger'), { code: 'ELECTRON_MBT_UNSUPPORTED_API' });
  assert.throws(() => new BrowserWindow({ webPreferences: { sandbox: false } }),
    { code: 'ELECTRON_MBT_UNSUPPORTED_API' });
  let loaded = 0;
  win.webContents.on('did-finish-load', () => { loaded++; });
  const promise = win.loadFile('index.html');
  const overlapping = win.loadFile('index.html');
  const overlapRejected = assert.rejects(overlapping, { code: 'ELECTRON_MBT_NAVIGATION_IN_PROGRESS' });
  assert.equal(typeof promise.then, 'function');
  // An immediate public sync operation must not race with queued WebKit loads.
  win.show();
  let nodeTurnRan = false;
  await new Promise(resolve => setImmediate(() => {
    nodeTurnRan = true;
    resolve();
  }));
  assert.equal(nodeTurnRan, true);
  await overlapRejected;
  await promise;
  assert.equal(loaded, 1);
  // A native terminal ACK must clear the loading guard *before* invoking
  // listeners. Both the second load and its completion use real WKWebView.
  let chained;
  win.webContents.once('did-finish-load', () => {
    chained = win.loadFile('index.html');
  });
  await win.loadFile('index.html');
  assert.ok(chained && typeof chained.then === 'function');
  await chained;
  assert.equal(loaded, 3);

  let loadFailures = 0;
  win.webContents.on('did-fail-load', () => { loadFailures++; });
  const listenerFailure = new Error('test listener exception');
  win.webContents.once('did-finish-load', () => { throw listenerFailure; });
  await assert.rejects(win.loadFile('index.html'), error => error === listenerFailure);
  assert.equal(loadFailures, 0);
  win.show();
  let cancelled = false;
  win.once('close', event => { event.preventDefault(); cancelled = true; });
  win.close();
  assert.equal(cancelled, true);
  assert.equal(win.isDestroyed(), false);
  // Native failure must never fabricate a successful closed transition.
  const validGeneration = win._generation;
  win._generation = 0;
  assert.throws(() => win.destroy(), { code: 'ELECTRON_MBT_STALE_DOCUMENT' });
  assert.equal(win.isDestroyed(), false);
  win._generation = validGeneration;
  win.destroy();
  assert.equal(win.isDestroyed(), true);
  const rapid = new BrowserWindow({ show: false });
  const inflight = rapid.loadFile('index.html');
  rapid.destroy();
  await assert.rejects(inflight);
  assert.equal(rapid.isDestroyed(), true);
  assert.equal(BrowserWindow.getAllWindows().length, 0);
  console.log(JSON.stringify({
    fixture: 'm1-cjs', status: 'PASS', readyOrder: true,
    synchronousConstructor: true, dependencyFacadeIdentity: true, realWebViewLoaded: true, overlappingLoadRejected: true, nodeEventLoopResponsive: true, immediateShowSafe: true,
    nativeDestroyErrorPreserved: true, inflightDestroySafe: true, closeCancelled: true,
    eventChainedLoad: true, listenerFailureNotNativeFailure: true,
    destroyForced: true, unsafeOptionsRejected: true, quitCancellationAndReentry: true, compatible: false,
  }));
  let cancelledQuit = 0;
  app.once('before-quit', event => { cancelledQuit++; event.preventDefault(); });
  app.quit();
  assert.equal(cancelledQuit, 1);
  assert.equal(app.isReady(), true);
  let reentrantQuit = 0;
  app.on('before-quit', () => {
    reentrantQuit++;
    app.quit();
    assert.throws(() => new BrowserWindow({ show: false }),
      { code: 'ELECTRON_MBT_INVALID_STATE' });
  });
  app.quit();
  assert.equal(reentrantQuit, 1);
}).catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
  app.quit();
});
