'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { inspectApp, snapshot } = require('../bridges/node/app-files.cjs');
const { ExperimentalRuntime } = require('../bridges/node/runtime-session.cjs');

async function waitForExit(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('Native host retained after stale-navigation test'));
    }, 4000);
    child.once('exit', () => { clearTimeout(timeout); resolve(); });
  });
}

async function main() {
  if (process.platform !== 'darwin') throw new Error('macOS native navigation test required');
  const root = path.resolve(__dirname, '../fixtures/m1-app');
  const nativeBinary = path.resolve(__dirname, '../dist/emoon-host-stale-navigation-test');
  const before = snapshot(root).sha256;
  const runtime = new ExperimentalRuntime(inspectApp(root), {
    nativeHostOptions: { testingExecutable: nativeBinary, watchdogMs: 10000 },
  });
  try {
    runtime.start();
    await runtime.app.whenReady();
    const window = new runtime.BrowserWindow({ show: false });
    let finishedLoads = 0;
    window.webContents.on('did-finish-load', () => { finishedLoads++; });
    await window.loadFile('index.html');
    assert.equal(window._generation, 1);
    assert.equal(finishedLoads, 1);

    let retiredCallbacks = null;
    const requestAsync = runtime.host.requestAsync.bind(runtime.host);
    runtime.host.requestAsync = (operation, windowID, generation, payload) => {
      const request = requestAsync(operation, windowID, generation, payload);
      if (operation === 'load-file' && generation === 2) {
        return request.then(reply => {
          retiredCallbacks = reply.testRetiredNavigationCallbackCount;
          return reply;
        });
      }
      return request;
    };

    const started = process.hrtime.bigint();
    const secondLoad = window.loadFile('slow.html');
    const secondLoadState = { settled: false };
    secondLoad.then(
      () => { secondLoadState.settled = true; },
      error => { secondLoadState.settled = true; secondLoadState.error = error; },
    );
    await new Promise(resolve => setTimeout(resolve, 350));
    assert.equal(window._generation, 2);
    assert.equal(secondLoadState.settled, false,
      'Generation 2 must remain pending while the test page is still executing');
    assert.equal(finishedLoads, 1,
      'A retired generation must not emit did-finish-load for the pending document');
    await secondLoad;
    const elapsedMs = Number((process.hrtime.bigint() - started) / 1000000n);
    assert.equal(retiredCallbacks, 3,
      'The test host must replay retired finish, failure, and provisional-failure callbacks');
    assert.ok(elapsedMs >= 500,
      'Generation 2 settled before its own deliberately slow WebKit document: ' + elapsedMs + 'ms');
    assert.equal(finishedLoads, 2);
    assert.equal(window.webContents.getURL(), pathToFileURL(path.join(root, 'slow.html')).href);
    assert.equal(snapshot(root).sha256, before, 'The fixture source must remain unchanged');

    window.destroy();
    runtime.quit();
    await waitForExit(runtime.host.process);
    console.log(JSON.stringify({
      probe: 'm1-navigation-generation-lifetime', status: 'PASS',
      retiredNavigationCallbacks: retiredCallbacks,
      generationTwoWaitedForOwnDocument: true,
      noPrematureDidFinishLoad: true,
      fixtureSourceUnchanged: true,
      elapsedMs,
      compatible: false,
    }));
  } finally { runtime.abort(); }
}

main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
