'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { inspectApp, snapshot } = require('../bridges/node/app-files.cjs');
const { expectNativeTitle } = require('./native-title-observation.cjs');
const { ExperimentalRuntime } = require('../bridges/node/runtime-session.cjs');

async function main() {
  if (process.platform !== 'darwin') throw new Error('Real WebKit subprocess termination requires macOS');
  // The normal host must be compiled without the private test selector.
  const production = fs.readFileSync(path.resolve(__dirname, '../dist/electron-mbt-native-host'));
  assert.equal(production.includes(Buffer.from('ELECTRON_MBT_TEST_WEBKIT_KILL_REQUESTED')), false,
    'Production native host unexpectedly includes the WebKit test-only kill path');
  const root = path.resolve(__dirname, '../fixtures/m1-app');
  const originalHash = snapshot(root).sha256;
  let stderr = '';
  const runtime = new ExperimentalRuntime(inspectApp(root), {
    nativeHostOptions: {
      testingExecutable: path.resolve(__dirname, '../dist/electron-mbt-native-host-webkit-kill-test'),
      testingOnSpawn(child) {
        child.stderr.on('data', chunk => {
          stderr = (stderr + chunk.toString('utf8')).slice(-4096);
        });
      },
    },
  });
  let timer;
  try {
    runtime.start();
    await runtime.app.whenReady();
    const window = new runtime.BrowserWindow({ show: false });
    let windowSignals = 0;
    let applicationSignals = 0;
    window.webContents.on('runtime-web-content-gone', () => windowSignals++);
    const gone = new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new Error('Real WebKit subprocess termination was not delivered')), 15000);
      runtime.app.once('runtime-web-content-gone', affected => {
        applicationSignals++;
        resolve(affected);
      });
      runtime.app.once('runtime-host-gone', error => {
        reject(error || new Error('Native host terminated instead of WebKit content process'));
      });
    });
    const loading = window.loadFile('index.html');
    await loading;
    assert.match(window.webContents.getURL(), /^file:\/\//);
    const affected = await gone;
    clearTimeout(timer);
    timer = null;
    const marker = stderr.match(/ELECTRON_MBT_TEST_WEBKIT_KILL_REQUESTED pid=(\d+)/);
    assert.ok(marker, 'Test-only native host must record an actual WKWebView process ID');
    const webProcessPid = Number(marker[1]);
    assert.ok(Number.isSafeInteger(webProcessPid) && webProcessPid > 1);
    assert.notEqual(webProcessPid, runtime.host.process.pid);
    assert.equal(affected, window);
    assert.equal(windowSignals, 1);
    assert.equal(applicationSignals, 1);
    assert.equal(window._renderProcessGone, true);
    assert.equal(window.isDestroyed(), false);
    assert.equal(runtime.terminated, false);
    assert.equal(runtime.host.dead, false);
    assert.equal(runtime.app.isReady(), true);
    assert.throws(() => window.show(), { code: 'ELECTRON_MBT_WEB_PROCESS_TERMINATED' });
    assert.throws(() => window.webContents.getURL(), { code: 'ELECTRON_MBT_WEB_PROCESS_TERMINATED' });
    assert.throws(() => window.webContents.getTitle(), { code: 'ELECTRON_MBT_WEB_PROCESS_TERMINATED' });
    await assert.rejects(window.loadFile('index.html'), {
      code: 'ELECTRON_MBT_WEB_PROCESS_TERMINATED',
    });
    window.destroy();
    const fresh = new runtime.BrowserWindow({ show: false });
    await fresh.loadFile('index.html');
    await expectNativeTitle(() => fresh.webContents.getTitle(), 'Experimental M1 CJS app');
    assert.equal(windowSignals, 1);
    assert.equal(applicationSignals, 1);
    fresh.destroy();
    runtime.quit();
    assert.equal(runtime.terminated, true);
    assert.equal(snapshot(root).sha256, originalHash);
    console.log(JSON.stringify({
      probe: 'm1-real-webkit-content-process-termination', status: 'PASS',
      testOnlyPrivateWebKitSelector: true, actualWebContentPidObserved: true,
      publicWebKitTerminationDelegate: true, moonbitDocumentRevoked: true,
      eventExactlyOnce: true, hostSurvivedProcessKill: true,
      survivingHostCanLoadNewWindow: true, sourceHashPreserved: true,
      completeProcessTreeAccounting: false, compatible: false,
    }));
  } finally {
    if (timer) clearTimeout(timer);
    runtime.abort();
  }
}
main().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
