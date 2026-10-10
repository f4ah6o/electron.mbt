'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const { inspectApp } = require('../bridges/node/app-files.cjs');
const { ExperimentalRuntime } = require('../bridges/node/runtime-session.cjs');
const { runtimeError } = require('../bridges/node/errors.cjs');

async function main() {
  if (process.platform !== 'darwin') throw new Error('macOS native event acceptance required');
  const app = inspectApp(path.resolve(__dirname, '../fixtures/m1-app'));
  const runtime = new ExperimentalRuntime(app);
  try {
    runtime.start();
    await runtime.app.whenReady();
    const window = new runtime.BrowserWindow({ show: false });
    let failureCount = 0, retry;
    const requestAsync = runtime.host.requestAsync.bind(runtime.host);
    let failOnce = true;
    runtime.host.requestAsync = (...args) => {
      if (failOnce) {
        failOnce = false;
        return Promise.reject(runtimeError('ELECTRON_MBT_TEST_INJECTED_LOAD_REJECTION',
          'Synthetic response for event-order regression'));
      }
      return requestAsync(...args);
    };
    window.webContents.once('did-fail-load', error => {
      failureCount++;
      assert.equal(error.code, 'ELECTRON_MBT_TEST_INJECTED_LOAD_REJECTION');
      retry = window.loadFile('index.html');
    });
    await assert.rejects(window.loadFile('index.html'), {
      code: 'ELECTRON_MBT_TEST_INJECTED_LOAD_REJECTION',
    });
    assert.ok(retry && typeof retry.then === 'function',
      'Failure listener must be allowed to navigate before its emitter returns');
    await retry;
    assert.equal(failureCount, 1);

    let spuriousFailures = 0;
    window.webContents.on('did-fail-load', () => { spuriousFailures++; });
    const sentinel = new Error('TEST_FINISHED_LISTENER_THREW');
    window.webContents.once('did-finish-load', () => { throw sentinel; });
    await assert.rejects(window.loadFile('index.html'), error => error === sentinel);
    assert.equal(spuriousFailures, 0,
      'User event-listener errors must not be converted to native did-fail-load');
    window.destroy();
    runtime.quit();
    console.log(JSON.stringify({
      probe: 'm1-load-event-chain', status: 'PASS',
      failureListenerRetryCommitted: true, noFalseFailureFromListenerThrow: true,
      realNativeRetryLoaded: true, compatible: false,
    }));
  } finally { runtime.abort(); }
}
main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
