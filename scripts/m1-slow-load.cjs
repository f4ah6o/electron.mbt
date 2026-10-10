'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const { inspectApp } = require('../bridges/node/app-files.cjs');
const { ExperimentalRuntime } = require('../bridges/node/runtime-session.cjs');

async function main() {
  if (process.platform !== 'darwin') throw new Error('macOS native slow-load test required');
  const root = path.resolve(__dirname, '../fixtures/m1-app');
  const runtime = new ExperimentalRuntime(inspectApp(root));
  try {
    runtime.start();
    await runtime.app.whenReady();
    const window = new runtime.BrowserWindow({ show: false });
    const load = window.loadFile('slow.html');
    const rejected = assert.rejects(load, error =>
      error && error.code === 'ELECTRON_MBT_WINDOW_DESTROYED');
    window.show();
    let turn = false;
    await new Promise(resolve => setTimeout(() => {
      turn = true;
      resolve();
    }, 40));
    assert.equal(turn, true);
    assert.equal(window.isDestroyed(), false);
    window.destroy();
    await rejected;
    assert.equal(window.isDestroyed(), true);
    runtime.quit();
    assert.equal(runtime.terminated, true);
    console.log(JSON.stringify({
      probe: 'm1-slow-webkit-load', status: 'PASS',
      nodeTimerResponsive: true, immediateShowWorks: true,
      pendingLoadRejectedOnDestroy: true, nativeWindowDestroyed: true,
      compatible: false,
    }));
  } finally { runtime.abort(); }
}
main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
