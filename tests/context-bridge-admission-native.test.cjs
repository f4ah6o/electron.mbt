'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { inspectApp } = require('../bridges/node/app-files.cjs');

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

test('What: B7 page admission fails closed when the real descriptor differs from the preview', {
  skip: process.platform !== 'darwin' ? 'AppKit/WKWebView is macOS-only: NOT RUN' : false,
  timeout: 60000,
}, async () => {
  const previousBridge = process.env.ELECTRON_MBT_B6_PRELOAD_BRIDGE;
  const previousTransport = process.env.ELECTRON_MBT_B6_TRANSPORT;
  process.env.ELECTRON_MBT_B6_PRELOAD_BRIDGE = '1';
  process.env.ELECTRON_MBT_B6_TRANSPORT = '1';
  const { ExperimentalRuntime } = require('../bridges/node/context-runtime.cjs');
  const fixtureRoot = path.resolve(__dirname, '../fixtures/b6-preload-app');
  const app = inspectApp(fixtureRoot);
  const runtime = new ExperimentalRuntime(app);
  let exposure = null;
  runtime.host.on('preload-exposure', event => { exposure = event; });
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
        preload: path.join(fixtureRoot, 'mismatch-preload.cjs'),
      },
    });
    await window.loadFile('mismatch.html').catch(() => {});
    await waitFor(() => runtime.host.dead === true || runtime.terminated === true,
      'preview/actual descriptor mismatch abort');
    assert.equal(runtime.host.dead, true);
    assert.ok(exposure, 'the real preload exposure event was observed');
    assert.equal(exposure.payload.apiKey, 'actual-key');
    assert.equal(exposure.payload.functionCount, 0);
    console.log(JSON.stringify({
      probe: 'b7-page-admission-mismatch', status: 'PASS',
      previewKey: 'preview-key', actualKey: exposure.payload.apiKey,
      failClosed: true, descriptorMismatchRejected: true,
      compatible: false, contextBridge: 'NOT_IMPLEMENTED',
      productionContextBridge: 'NOT_IMPLEMENTED',
    }));
  } finally {
    runtime.abort();
    if (previousBridge === undefined) delete process.env.ELECTRON_MBT_B6_PRELOAD_BRIDGE;
    else process.env.ELECTRON_MBT_B6_PRELOAD_BRIDGE = previousBridge;
    if (previousTransport === undefined) delete process.env.ELECTRON_MBT_B6_TRANSPORT;
    else process.env.ELECTRON_MBT_B6_TRANSPORT = previousTransport;
  }
});
