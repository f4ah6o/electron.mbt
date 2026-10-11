'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const { inspectApp } = require('../bridges/node/app-files.cjs');
const { ExperimentalRuntime } = require('../bridges/node/runtime-session.cjs');

async function main() {
  if (process.platform !== 'darwin') throw new Error('macOS native renderer test required');
  const app = inspectApp(path.resolve(__dirname, '../fixtures/m1-app'));
  const runtime = new ExperimentalRuntime(app, {
    nativeHostOptions: {
      testingExecutable: path.resolve(__dirname, '../dist/electron-mbt-native-host-termination-sim'),
    },
  });
  let timeout;
  try {
    runtime.start();
    await runtime.app.whenReady();
    const window = new runtime.BrowserWindow({ show: false });
    const gone = new Promise((resolve, reject) => {
      timeout = setTimeout(() => reject(new Error(
        'Simulated WKWebView delegate termination did not reach the MoonBit event gate')), 9000);
      runtime.app.once('runtime-web-content-gone', resolve);
    });
    const loaded = window.loadFile('index.html');
    await loaded;
    const affected = await gone;
    clearTimeout(timeout);
    assert.equal(affected, window);
    assert.equal(window._renderProcessGone, true);
    assert.equal(runtime.terminated, false);
    assert.throws(() => window.show(), { code: 'ELECTRON_MBT_WEB_PROCESS_TERMINATED' });
    await assert.rejects(window.loadFile('index.html'), {
      code: 'ELECTRON_MBT_WEB_PROCESS_TERMINATED',
    });
    window.destroy();
    runtime.quit();
    assert.equal(runtime.terminated, true);
    console.log(JSON.stringify({
      probe: 'm1-webkit-delegate-termination-simulation', status: 'PASS',
      delegateCallbackSimulated: true, nativeEventValidatedByMoonBit: true,
      documentGenerationRevoked: true, subsequentShowRejected: true,
      hostStayedAliveForCleanup: true, realWebKitCrashTested: false, compatible: false,
    }));
  } finally {
    if (timeout) clearTimeout(timeout);
    runtime.abort();
  }
}
main().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
