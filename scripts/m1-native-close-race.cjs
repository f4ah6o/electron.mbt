'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const { inspectApp } = require('../bridges/node/app-files.cjs');
const { ExperimentalRuntime } = require('../bridges/node/runtime-session.cjs');

function deadline(promise, duration, label) {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(label)), duration);
  })]).finally(() => clearTimeout(timer));
}
async function main() {
  if (process.platform !== 'darwin') throw new Error('AppKit host required');
  const app = inspectApp(path.resolve(__dirname, '../fixtures/m1-app'));
  const runtime = new ExperimentalRuntime(app, {
    nativeHostOptions: {
      testingExecutable: path.resolve(__dirname,
        '../dist/electron-mbt-native-host-close-sim'),
    },
  });
  try {
    let deferFirst;
    const firstQueued = new Promise(resolve => { deferFirst = resolve; });
    const emit = runtime.host.emit.bind(runtime.host);
    let held = false;
    runtime.host.emit = (name, ...details) => {
      if (name === 'native-close-request' && !held) {
        held = true;
        deferFirst(details[0]);
        return true;
      }
      return emit(name, ...details);
    };
    runtime.start();
    await runtime.app.whenReady();
    const window = new runtime.BrowserWindow({
      show: true, width: 620, height: 450, title: 'Queued OS close race',
    });
    let closeCount = 0, closedCount = 0;
    window.on('close', event => {
      closeCount++;
      if (closeCount === 1) event.preventDefault();
    });
    window.on('closed', () => { closedCount++; });
    const closed = new Promise(resolve => window.once('closed', resolve));
    const queued = await deadline(firstQueued, 5000,
      'Native close request was not queued by AppKit');
    assert.ok(queued.request > 0);
    assert.equal(closeCount, 0);

    // Exactly the ordering from the review: AppKit already requested close,
    // but Node's event callback is deliberately delayed. An independent
    // programmatic close gets cancelled first, ACKing the pending native ID.
    window.close();
    assert.equal(closeCount, 1);
    assert.equal(window.isDestroyed(), false);
    assert.ok(window._cancelledNativeCloseThrough >= queued.request);

    // The previously queued physical event must not re-emit close. The
    // second (new) AppKit performClose gesture should still work normally.
    emit('native-close-request', queued);
    assert.equal(closeCount, 1);
    assert.equal(closedCount, 0);
    await deadline(closed, 6500,
      'Second genuine native close request did not close the window');
    assert.equal(closeCount, 2);
    assert.equal(closedCount, 1);
    assert.equal(window.isDestroyed(), true);
    runtime.quit();
    console.log(JSON.stringify({
      probe: 'm1-native-close-event-correlation', status: 'PASS',
      queuedFirstNativeAttempt: true,
      programmaticCancelAcknowledgedThatAttempt: true,
      staleNativeNoticeIgnored: true,
      nextNativeGestureAllowed: true,
      noDoubleCloseForSingleGesture: true,
      compatible: false,
      note: 'first native event delivery deliberately delayed by Node test wrapper',
    }));
  } finally { runtime.abort(); }
}
main().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
