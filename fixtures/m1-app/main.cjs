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
  const superseded = win.loadFile('index.html');
  const promise = win.loadFile('index.html');
  assert.equal(typeof promise.then, 'function');
  await assert.rejects(superseded, { code: 'ELECTRON_MBT_STALE_DOCUMENT' });
  await promise;
  assert.equal(loaded, 1);
  win.show();
  let cancelled = false;
  win.once('close', event => { event.preventDefault(); cancelled = true; });
  win.close();
  assert.equal(cancelled, true);
  assert.equal(win.isDestroyed(), false);
  win.destroy();
  assert.equal(win.isDestroyed(), true);
  assert.equal(BrowserWindow.getAllWindows().length, 0);
  console.log(JSON.stringify({
    fixture: 'm1-cjs', status: 'PASS', readyOrder: true,
    synchronousConstructor: true, dependencyFacadeIdentity: true, realWebViewLoaded: true, staleLoadCancelled: true, closeCancelled: true,
    destroyForced: true, unsafeOptionsRejected: true, compatible: false,
  }));
  app.quit();
}).catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
  app.quit();
});
