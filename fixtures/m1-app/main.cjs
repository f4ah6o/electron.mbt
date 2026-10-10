'use strict';
const assert = require('node:assert/strict');
const { app, BrowserWindow } = require('electron');
const dependencyFacade = require('./dependency/index.cjs');
async function expectNativeTitle(readTitle, expected) {
  const deadline = Date.now() + 3000;
  let observed;
  do {
    observed = readTitle();
    if (observed === expected) return;
    if (Date.now() >= deadline) break;
    await new Promise(resolve => setTimeout(resolve, 30));
  } while (true);
  assert.equal(observed, expected, 'Actual native WebKit title did not become observable');
}
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
  const initialBounds = win.getBounds();
  assert.deepEqual(Object.keys(initialBounds).sort(), ['height', 'width', 'x', 'y']);
  assert.equal(initialBounds.width, 640);
  assert.equal(initialBounds.height, 480);
  assert.ok(Number.isSafeInteger(initialBounds.x) && Number.isSafeInteger(initialBounds.y));
  assert.equal(win.setBounds({ width: initialBounds.width + 32 }, false), undefined);
  assert.equal(win.getBounds().width, initialBounds.width + 32);
  assert.equal(win.isVisible(), false);
  assert.equal(win.setBounds({ width: initialBounds.width }), undefined);
  assert.equal(win.getBounds().width, initialBounds.width);
  assert.equal(win.setBounds({}), undefined);
  assert.deepEqual(win.getBounds(), initialBounds);
  assert.throws(() => win.setBounds({ width: 700 }, true), { code: 'ELECTRON_MBT_UNSUPPORTED_API' });
  assert.throws(() => win.setBounds({ width: 20 }), { code: 'ELECTRON_MBT_INVALID_ARGUMENT' });
  assert.deepEqual(win.getBounds(), initialBounds);
  assert.equal(win.isVisible(), false);
  assert.equal(win.hide(), undefined);
  assert.equal(win.isVisible(), false);
  assert.equal(win.show(), undefined);
  assert.equal(win.isVisible(), true);
  assert.equal(win.hide(), undefined);
  assert.equal(win.isVisible(), false);
  assert.deepEqual(win.getBounds(), initialBounds);
  assert.equal(win.getTitle(), 'M1 CJS fixture');
  assert.equal(win.webContents.getURL(), '');
  assert.equal(win.webContents.getTitle(), '');
  assert.equal(win.setTitle('M1 title 日本語'), undefined);
  assert.equal(win.getTitle(), 'M1 title 日本語');
  assert.throws(() => win.setTitle(12), { code: 'ELECTRON_MBT_INVALID_ARGUMENT' });
  assert.equal(win.getTitle(), 'M1 title 日本語');
  for (const invalid of ['\uD800', '\uDC00', 'x'.repeat(255) + '\uD83D']) {
    assert.throws(() => win.setTitle(invalid), { code: 'ELECTRON_MBT_INVALID_ARGUMENT' });
    assert.throws(() => new BrowserWindow({ title: invalid, show: false }),
      { code: 'ELECTRON_MBT_UNSUPPORTED_API' });
    assert.equal(win.isDestroyed(), false);
    assert.equal(app.isReady(), true);
    assert.equal(win.getTitle(), 'M1 title 日本語');
  }
  const boundedEmojiTitle = 'x'.repeat(254) + '\uD83D\uDE00';
  assert.equal(win.setTitle(boundedEmojiTitle), undefined);
  assert.equal(win.getTitle(), boundedEmojiTitle);
  assert.equal(win.setTitle('M1 title 日本語'), undefined);
  assert.equal(win.getTitle(), 'M1 title 日本語');
  assert.deepEqual(win.getBounds(), initialBounds);
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
  assert.equal(win.isVisible(), true);
  let nodeTurnRan = false;
  await new Promise(resolve => setImmediate(() => {
    nodeTurnRan = true;
    resolve();
  }));
  assert.equal(nodeTurnRan, true);
  await overlapRejected;
  await promise;
  assert.equal(loaded, 1);
  assert.deepEqual(win.getBounds(), initialBounds);
  assert.match(win.webContents.getURL(), /^file:\/\/.*\/index\.html$/);
  await expectNativeTitle(() => win.webContents.getTitle(), 'Experimental M1 CJS app');
  assert.equal(win.getTitle(), 'M1 title 日本語');
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
  let visibilityRejectedInsideClosed = false;
  win.once('closed', () => {
    assert.equal(win.isDestroyed(), true);
    assert.throws(() => win.isVisible(), { code: 'ELECTRON_MBT_WINDOW_DESTROYED' });
    assert.throws(() => win.webContents.getURL(), { code: 'ELECTRON_MBT_WINDOW_DESTROYED' });
    assert.throws(() => win.webContents.getTitle(), { code: 'ELECTRON_MBT_WINDOW_DESTROYED' });
    assert.throws(() => win.getBounds(), { code: 'ELECTRON_MBT_WINDOW_DESTROYED' });
    assert.throws(() => win.setBounds({ width: 700 }), { code: 'ELECTRON_MBT_WINDOW_DESTROYED' });
    visibilityRejectedInsideClosed = true;
  });
  win.destroy();
  assert.equal(win.isDestroyed(), true);
  assert.equal(visibilityRejectedInsideClosed, true);
  assert.throws(() => win.isVisible(), { code: 'ELECTRON_MBT_WINDOW_DESTROYED' });
  assert.throws(() => win.getTitle(), { code: 'ELECTRON_MBT_WINDOW_DESTROYED' });
  assert.throws(() => win.getBounds(), { code: 'ELECTRON_MBT_WINDOW_DESTROYED' });
  assert.throws(() => win.setBounds({ x: 20 }), { code: 'ELECTRON_MBT_WINDOW_DESTROYED' });
  assert.throws(() => win.webContents.getURL(), { code: 'ELECTRON_MBT_WINDOW_DESTROYED' });
  assert.throws(() => win.webContents.getTitle(), { code: 'ELECTRON_MBT_WINDOW_DESTROYED' });
  assert.throws(() => win.setTitle('forbidden'), { code: 'ELECTRON_MBT_WINDOW_DESTROYED' });
  assert.throws(() => win.hide(), { code: 'ELECTRON_MBT_WINDOW_DESTROYED' });
  const rapid = new BrowserWindow({ show: false });
  const inflight = rapid.loadFile('index.html');
  rapid.destroy();
  await assert.rejects(inflight);
  assert.equal(rapid.isDestroyed(), true);
  assert.equal(BrowserWindow.getAllWindows().length, 0);
  let windowAllClosed = 0;
  let willQuit = 0;
  app.on('window-all-closed', () => { windowAllClosed++; });
  app.on('will-quit', () => { willQuit++; });

  const ordinaryWindow = new BrowserWindow({ show: false });
  ordinaryWindow.destroy();
  assert.equal(windowAllClosed, 1);

  const quitWindow = new BrowserWindow({ show: false });
  let beforeQuitCancelled = 0;
  app.once('before-quit', event => { beforeQuitCancelled++; event.preventDefault(); });
  app.quit();
  assert.equal(beforeQuitCancelled, 1);
  assert.equal(quitWindow.isDestroyed(), false);
  assert.equal(app.isReady(), true);
  assert.equal(willQuit, 0);
  assert.equal(windowAllClosed, 1);

  let closeCancelledDuringQuit = 0;
  quitWindow.once('close', event => {
    closeCancelledDuringQuit++;
    event.preventDefault();
  });
  app.quit();
  assert.equal(closeCancelledDuringQuit, 1);
  assert.equal(quitWindow.isDestroyed(), false);
  assert.equal(BrowserWindow.getAllWindows().length, 1);
  assert.equal(app.isReady(), true);
  assert.equal(willQuit, 0);
  assert.equal(windowAllClosed, 1);

  let willQuitCancelled = 0;
  app.once('will-quit', event => { willQuitCancelled++; event.preventDefault(); });
  app.quit();
  assert.equal(willQuitCancelled, 1);
  assert.equal(willQuit, 1);
  assert.equal(quitWindow.isDestroyed(), true);
  assert.equal(BrowserWindow.getAllWindows().length, 0);
  assert.equal(app.isReady(), true);
  assert.equal(windowAllClosed, 1);

  const finalWindow = new BrowserWindow({ show: false });
  const order = [];
  let reentrantQuit = 0;
  app.once('before-quit', () => {
    reentrantQuit++;
    app.quit();
    assert.throws(() => new BrowserWindow({ show: false }),
      { code: 'ELECTRON_MBT_INVALID_STATE' });
  });
  app.on('before-quit', () => order.push('before-quit'));
  finalWindow.on('close', () => order.push('close'));
  finalWindow.on('closed', () => order.push('closed'));
  app.once('will-quit', () => order.push('will-quit'));
  let quitEventArguments = false;
  app.once('quit', (event, exitCode) => {
    assert.equal(typeof event, 'object');
    assert.equal(typeof event.preventDefault, 'function');
    assert.equal(exitCode, 0);
    quitEventArguments = true;
    order.push('quit');
  });
  app.quit();
  assert.equal(quitEventArguments, true);
  assert.deepEqual(order, ['before-quit', 'close', 'closed', 'will-quit', 'quit']);
  assert.equal(reentrantQuit, 1);
  assert.equal(willQuit, 2);
  assert.equal(windowAllClosed, 1);
  assert.equal(finalWindow.isDestroyed(), true);

  console.log(JSON.stringify({
    fixture: 'm1-cjs', status: 'PASS', readyOrder: true,
    synchronousConstructor: true, dependencyFacadeIdentity: true, realWebViewLoaded: true, overlappingLoadRejected: true, nodeEventLoopResponsive: true, immediateShowSafe: true,
    nativeDestroyErrorPreserved: true, inflightDestroySafe: true, closeCancelled: true,
    eventChainedLoad: true, listenerFailureNotNativeFailure: true,
    destroyForced: true, nativeVisibilityRoundTrip: true,
    destroyedVisibilityRejected: true, closedListenerVisibilityRejected: true,
    nativeTitleRoundTrip: true, destroyedTitleRejected: true,
    invalidSurrogateKeepsHost: true,
    nativeWebContentsURL: true, destroyedWebContentsURLRejected: true,
    nativeWebContentsTitle: true, destroyedWebContentsTitleRejected: true,
    nativeWindowBounds: true, destroyedWindowBoundsRejected: true,
    nativeSetBoundsRoundTrip: true, destroyedSetBoundsRejected: true,
    unsafeOptionsRejected: true, quitCancellationAndReentry: true,
    quitCloseCancellation: true, willQuitCancellation: true,
    quitEventOrder: true, quitEventArguments: true,
    noWindowAllClosedDuringQuit: true, compatible: false,
  }));
}).catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
  app.quit();
});
