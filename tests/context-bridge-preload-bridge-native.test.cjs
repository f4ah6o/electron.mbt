'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { inspectApp, snapshot } = require('../bridges/node/app-files.cjs');

function sha256(file) {
  return require('node:crypto').createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}
function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

test('What: B6-B preload environment registers exposure authority without a page API', {
  skip: process.platform !== 'darwin' ? 'AppKit/WKWebView is macOS-only: NOT RUN' : false,
  timeout: 60000,
}, async () => {
  const previous = process.env.ELECTRON_MBT_B6_PRELOAD_BRIDGE;
  process.env.ELECTRON_MBT_B6_PRELOAD_BRIDGE = '1';
  const { ExperimentalRuntime } = require('../bridges/node/context-runtime.cjs');
  const app = inspectApp(path.resolve(__dirname, '../fixtures/b6-preload-app'));
  const fixtureRoot = path.resolve(__dirname, '../fixtures/b6-preload-app');
  const before = snapshot(fixtureRoot).sha256;
  const oraclePreload = path.resolve(__dirname, '../fixtures/oracle/preload.cjs');
  const preload = path.join(fixtureRoot, 'preload.cjs');
  assert.equal(sha256(preload), sha256(oraclePreload), 'B6-B fixture must carry the unchanged preload');
  const runtime = new ExperimentalRuntime(app);
  const exposures = [];
  const verified = [];
  runtime.host.on('preload-exposure', event => exposures.push(event));
  runtime.host.on('isolated-preload-attested', event => verified.push(event));
  const waitFor = async (predicate, label) => {
    for (let attempt = 0; attempt < 150; attempt++) {
      if (predicate()) return;
      await sleep(20);
    }
    throw new Error(`Timed out waiting for ${label}`);
  };
  const waitTitle = async (window, expected) => {
    await waitFor(() => window.webContents.getTitle() === expected, expected);
  };
  try {
    runtime.start();
    await runtime.app.whenReady();
    const window = new runtime.BrowserWindow({
      show: false,
      webPreferences: {
        nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true,
        preload,
      },
    });
    await window.loadFile('index.html');
    await waitTitle(window, 'B6_PRELOAD_BRIDGE_OK');
    await waitFor(() => verified.some(event => event.window === window.id &&
      event.generation === window._generation), 'isolated preload attestation');
    await waitFor(() => exposures.filter(event => event.window === window.id).length === 1,
      'preload exposure event');
    await waitFor(() => runtime.core.context_bridge_exposure_count(runtime.runtime) === 1,
      'MoonBit exposure registration');
    const exposure = exposures.find(event => event.window === window.id);
    assert.equal(exposure.payload.apiKey, 'fixture');
    assert.equal(exposure.payload.functionCount, 10);
    assert.ok(exposure.payload.descriptorBytes > 0);
    assert.match(exposure.payload.descriptorSHA256, /^[0-9a-f]{64}$/);
    assert.deepEqual(runtime.host.request('get-preload-status', window.id, window._generation), {
      status: 'ok', detail: '',
    });
    // The page-world probe confirms B6-B does not expose the API yet.
    assert.equal(window.webContents.getTitle(), 'B6_PRELOAD_BRIDGE_OK');

    await window.loadFile('index.html');
    await waitTitle(window, 'B6_PRELOAD_BRIDGE_OK');
    await waitFor(() => exposures.filter(event => event.window === window.id).length === 2,
      'reload preload exposure event');
    await waitFor(() => runtime.core.context_bridge_exposure_count(runtime.runtime) === 1,
      'reload MoonBit exposure registration');
    assert.equal(runtime.host.request('get-preload-status', window.id, window._generation).status, 'ok');
    window.destroy();
    await waitFor(() => runtime.core.context_bridge_exposure_count(runtime.runtime) === 0,
      'exposure revocation on destroy');
    assert.equal(snapshot(fixtureRoot).sha256, before);
    console.log(JSON.stringify({
      probe: 'b6-preload-bridge', status: 'PASS',
      preloadSourceUnchanged: true, preloadBridgeStatus: 'ok',
      exposureRegistered: true, exposureRevokedOnReload: true,
      pageApiNotMaterialized: true, nativeHandlersHiddenFromPage: true,
      compatible: false, contextBridge: 'NOT_IMPLEMENTED',
      productionContextBridge: 'NOT_IMPLEMENTED',
    }));
  } finally {
    runtime.abort();
    if (previous === undefined) delete process.env.ELECTRON_MBT_B6_PRELOAD_BRIDGE;
    else process.env.ELECTRON_MBT_B6_PRELOAD_BRIDGE = previous;
  }
});
