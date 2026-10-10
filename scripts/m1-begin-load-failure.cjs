'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const { inspectApp } = require('../bridges/node/app-files.cjs');
const { ExperimentalRuntime } = require('../bridges/node/runtime-session.cjs');

async function waitForExit(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('Native child retained after failed begin-load'));
    }, 4000);
    child.once('exit', () => { clearTimeout(timeout); resolve(); });
  });
}
async function main() {
  if (process.platform !== 'darwin') throw new Error('macOS native generation test required');
  const appInfo = inspectApp(path.resolve(__dirname, '../fixtures/m1-app'));
  const runtime = new ExperimentalRuntime(appInfo);
  try {
    runtime.start();
    await runtime.app.whenReady();
    const window = new runtime.BrowserWindow({ show: false });
    // Inject a native generation reservation that the MoonBit runtime did
    // not issue. A failed second reservation must poison the whole session.
    assert.equal(runtime.host.request('begin-load', window.id, 1).generation, 1);
    await assert.rejects(window.loadFile('index.html'), {
      code: 'ELECTRON_MBT_STALE_DOCUMENT',
    });
    assert.equal(runtime.terminated, true);
    assert.equal(window.isDestroyed(), true);
    assert.equal(runtime.BrowserWindow.getAllWindows().length, 0);
    assert.throws(() => window.show(), {
      code: 'ELECTRON_MBT_WINDOW_DESTROYED',
    });
    window.destroy();
    await assert.rejects(window.loadFile('index.html'), {
      code: 'ELECTRON_MBT_WINDOW_DESTROYED',
    });
    assert.throws(() => new runtime.BrowserWindow({ show: false }), {
      code: 'ELECTRON_MBT_INVALID_STATE',
    });
    await waitForExit(runtime.host.process);
    console.log(JSON.stringify({
      probe: 'm1-begin-load-failure', status: 'PASS',
      staleNativeReservationRejected: true, moonbitStateRevoked: true,
      windowInvalidated: true, subsequentShowDenied: true,
      subsequentReloadDenied: true, noOrphanHost: true, compatible: false,
    }));
  } finally { runtime.abort(); }
}
main().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
