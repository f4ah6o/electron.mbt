'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { inspectApp, snapshot } = require('../bridges/node/app-files.cjs');
const { validateM0ElectronOracleObservation } = require('../scripts/m0-electron-oracle-evidence.cjs');

function sha256(file) {
  return require('node:crypto').createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}
function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

test('What: B6-C transport runs the unchanged oracle page/preload synchronously', {
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
  const before = snapshot(fixtureRoot).sha256;
  const preload = path.join(fixtureRoot, 'preload.cjs');
  const oraclePreload = path.resolve(__dirname, '../fixtures/oracle/preload.cjs');
  const oraclePage = path.resolve(__dirname, '../fixtures/oracle/index.html');
  assert.equal(sha256(preload), sha256(oraclePreload));
  assert.equal(sha256(path.join(fixtureRoot, 'oracle.html')), sha256(oraclePage));
  const runtime = new ExperimentalRuntime(app);
  const reports = [];
  const exposures = [];
  const verified = [];
  runtime.host.on('preload-report', event => reports.push(event));
  runtime.host.on('preload-exposure', event => exposures.push(event));
  runtime.host.on('isolated-preload-attested', event => verified.push(event));
  const waitFor = async (predicate, label) => {
    for (let attempt = 0; attempt < 200; attempt++) {
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
        preload,
      },
    });
    await window.loadFile('oracle.html');
    await waitFor(() => verified.some(event => event.window === window.id &&
      event.generation === window._generation), 'isolated preload attestation');
    await waitFor(() => reports.length >= 1, 'oracle report');
    await waitFor(() => runtime.core.context_bridge_exposure_count(runtime.runtime) === 1,
      'MoonBit exposure registration');
    const report = reports.find(event => event.window === window.id &&
      event.payload?.channel === 'fixture:report');
    assert.ok(report, 'fixture:report event');
    const observed = validateM0ElectronOracleObservation(report.payload.value);
    let oracleBaseline = 'NOT_RUN';
    const baselinePath = path.resolve(__dirname, '../evidence/electron-baseline.json');
    if (fs.existsSync(baselinePath)) {
      const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
      assert.ok(baseline?.observed?.observation, 'Electron baseline observation is missing');
      assert.deepEqual(observed, validateM0ElectronOracleObservation(baseline.observed.observation));
      oracleBaseline = 'PASS';
    } else if (process.env.ELECTRON_MBT_REQUIRE_ORACLE_BASELINE === '1') {
      assert.fail('Electron oracle baseline is required but missing');
    }
    assert.equal(observed.syncValue, 42);
    assert.equal(observed.promiseValue, 43);
    assert.deepEqual(observed.callbackValues, ['first', 'second']);
    assert.equal(observed.dataFrozen, true);
    assert.equal(observed.primordialIntact, true);
    assert.equal(window.webContents.getTitle(), 'electron.mbt differential bridge fixture');
    assert.deepEqual(runtime.host.request('get-preload-status', window.id, window._generation), {
      status: 'ok', detail: '',
    });
    assert.equal(exposures.length >= 1, true);
    assert.equal(exposures[0].payload.apiKey, 'fixture');
    assert.ok(exposures[0].payload.functionCount >= 10);
    assert.match(exposures[0].payload.descriptorSHA256, /^[0-9a-f]{64}$/);

    await window.loadFile('oracle.html');
    await waitFor(() => reports.filter(event => event.window === window.id).length >= 2,
      'reload oracle report');
    await waitFor(() => runtime.core.context_bridge_exposure_count(runtime.runtime) === 1,
      'reload exposure registration');
    const reload = reports.filter(event => event.window === window.id).at(-1);
    validateM0ElectronOracleObservation(reload.payload.value);
    window.destroy();
    await waitFor(() => runtime.core.context_bridge_exposure_count(runtime.runtime) === 0,
      'exposure revocation');
    assert.equal(snapshot(fixtureRoot).sha256, before);
    console.log(JSON.stringify({
      probe: 'b6-context-bridge-transport', status: 'PASS',
      preloadSourceUnchanged: true, oraclePageUnchanged: true,
      firstScriptSynchronous: true, syncThrow: true,
      promiseFulfilled: true, promiseRejected: true,
      callbacks: true, frozenCopies: true, primordialIsolation: true,
      exposureRegistered: reload !== undefined,
      reloadObservation: true, sourceHashPreserved: true,
      oracleBaseline,
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
