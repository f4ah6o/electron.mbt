'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { inspectApp } = require('../bridges/node/app-files.cjs');

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

test('What: a same-key descriptor mismatch blocks the page before it can materialize the API', {
  skip: process.platform !== 'darwin' ? 'AppKit/WKWebView is macOS-only: NOT RUN' : false,
  timeout: 60000,
}, async () => {
  const previousBridge = process.env.ELECTRON_MBT_B6_PRELOAD_BRIDGE;
  const previousTransport = process.env.ELECTRON_MBT_B6_TRANSPORT;
  const previousObserve = process.env.ELECTRON_MBT_B6_ADMISSION_OBSERVE;
  process.env.ELECTRON_MBT_B6_PRELOAD_BRIDGE = '1';
  process.env.ELECTRON_MBT_B6_TRANSPORT = '1';
  // Test-only: keep the host alive so the native E2E can read the page title
  // after the page shim rejected the unadmitted descriptor. The default path
  // still aborts the runtime on this mismatch.
  process.env.ELECTRON_MBT_B6_ADMISSION_OBSERVE = '1';
  const { ExperimentalRuntime } = require('../bridges/node/context-runtime.cjs');
  const fixtureRoot = path.resolve(__dirname, '../fixtures/b6-preload-app');
  const app = inspectApp(fixtureRoot);
  const runtime = new ExperimentalRuntime(app);
  const waitFor = async (predicate, label) => {
    for (let attempt = 0; attempt < 250; attempt++) {
      if (predicate()) return;
      await sleep(20);
    }
    throw new Error(`Timed out waiting for ${label}`);
  };
  try {
    runtime.start();
    await runtime.app.whenReady();
    const window = new runtime.BrowserWindow({
      show: false,
      webPreferences: {
        nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true,
        preload: path.join(fixtureRoot, 'same-key-preload.cjs'),
      },
    });
    await window.loadFile('same-key.html');
    await waitFor(() => runtime.admissionMismatch !== null, 'preview/actual descriptor mismatch');
    const mismatch = runtime.admissionMismatch;
    assert.equal(mismatch.preview.apiKey, 'fixture');
    assert.equal(mismatch.actual.apiKey, 'fixture');
    assert.equal(mismatch.preview.functionCount, 1);
    assert.equal(mismatch.actual.functionCount, 2);
    assert.notEqual(mismatch.preview.descriptorSha256, mismatch.actual.descriptorSha256);
    let title = '';
    await waitFor(() => {
      title = runtime.host.request('get-web-contents-title', window.id, window._generation).title;
      return title.startsWith('admission:');
    }, 'page admission outcome');
    assert.equal(title, 'admission:blocked:ELECTRON_MBT_BRIDGE_ADMISSION_MISMATCH',
      'the page must fail closed before materializing the actual API');
    assert.equal(runtime.core.context_bridge_exposure_count(runtime.runtime), 1,
      'only the pre-registered preview exposure may exist');
    console.log(JSON.stringify({
      probe: 'b7-descriptor-admission-binding', status: 'PASS',
      previewKey: mismatch.preview.apiKey, actualKey: mismatch.actual.apiKey,
      previewFunctionCount: mismatch.preview.functionCount,
      actualFunctionCount: mismatch.actual.functionCount,
      pageOutcome: title, pageMaterialized: false, hostAborted: false,
      observeMode: true, compatible: false,
      contextBridge: 'NOT_IMPLEMENTED', productionContextBridge: 'NOT_IMPLEMENTED',
    }));
  } finally {
    runtime.abort();
    if (previousBridge === undefined) delete process.env.ELECTRON_MBT_B6_PRELOAD_BRIDGE;
    else process.env.ELECTRON_MBT_B6_PRELOAD_BRIDGE = previousBridge;
    if (previousTransport === undefined) delete process.env.ELECTRON_MBT_B6_TRANSPORT;
    else process.env.ELECTRON_MBT_B6_TRANSPORT = previousTransport;
    if (previousObserve === undefined) delete process.env.ELECTRON_MBT_B6_ADMISSION_OBSERVE;
    else process.env.ELECTRON_MBT_B6_ADMISSION_OBSERVE = previousObserve;
  }
});
