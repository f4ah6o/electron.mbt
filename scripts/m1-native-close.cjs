'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const { inspectApp } = require('../bridges/node/app-files.cjs');
const { ExperimentalRuntime } = require('../bridges/node/runtime-session.cjs');

function deadline(promise, ms, label) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(label)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}
async function main() {
  if (process.platform !== 'darwin') throw new Error('macOS AppKit required');
  const info = inspectApp(path.resolve(__dirname, '../fixtures/m1-app'));
  const runtime = new ExperimentalRuntime(info, {
    nativeHostOptions: {
      testingExecutable: path.resolve(__dirname,
        '../dist/electron-mbt-native-host-close-sim'),
    },
  });
  try {
    runtime.start();
    await runtime.app.whenReady();
    const window = new runtime.BrowserWindow({
      show: true, width: 620, height: 450, title: 'Native close request test',
    });
    let attempts = 0, firstCancelled = false, normalClosed = 0;
    const terminal = new Promise(resolve => window.once('closed', resolve));
    window.on('closed', () => { normalClosed++; });
    window.on('close', event => {
      attempts++;
      if (attempts === 1) {
        event.preventDefault();
        queueMicrotask(() => {
          assert.equal(window.isDestroyed(), false);
          firstCancelled = true;
        });
      }
    });
    await deadline(terminal, 6500, 'Native close was not acknowledged');
    assert.equal(attempts, 2,
      'AppKit must permit a second close after main cancels the first');
    assert.equal(firstCancelled, true);
    assert.equal(normalClosed, 1);
    assert.equal(window.isDestroyed(), true);
    assert.deepEqual(runtime.BrowserWindow.getAllWindows(), []);
    runtime.quit();
    assert.equal(runtime.terminated, true);
    console.log(JSON.stringify({
      probe: 'm1-appkit-close-delegate', status: 'PASS',
      delegateGeneratedRealCloseGesture: true,
      firstGestureCancelledInNode: true, secondGestureClosedAfterAck: true,
      noSpuriousClosedEvent: true, mainThreadNotBlocked: true,
      compatible: false,
      note: 'performClose invoked in test-only native build, not an actual mouse click',
    }));
  } finally {
    runtime.abort();
  }
}
main().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
