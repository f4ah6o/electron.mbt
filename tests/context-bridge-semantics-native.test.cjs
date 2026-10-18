'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { inspectApp, snapshot } = require('../bridges/node/app-files.cjs');

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

test('What: B6-D production transport covers the value/error/callback/Promise matrix', {
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
  const runtime = new ExperimentalRuntime(app);
  const reports = [];
  const exposures = [];
  runtime.host.on('preload-report', event => reports.push(event));
  runtime.host.on('preload-exposure', event => exposures.push(event));
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
        preload: path.join(fixtureRoot, 'edge-preload.cjs'),
      },
    });
    await window.loadFile('edge.html');
    await waitFor(() => reports.some(event => event.window === window.id &&
      event.payload?.channel === 'edge:report'), 'edge report');
    await waitFor(() => runtime.core.context_bridge_exposure_count(runtime.runtime) === 1,
      'edge exposure registration');
    const report = reports.find(event => event.window === window.id &&
      event.payload?.channel === 'edge:report');
    const state = report.payload.value;
    assert.equal(state.fixtureError, null);
    assert.equal(state.available, true);
    assert.equal(state.dataFrozen, true);
    assert.equal(state.dataUnchanged, true);
    assert.deepEqual(state.echo, {
      number: 42, string: 'text', boolean: true, nullable: null,
      array: [1, 'two', null], object: { a: 1, b: { c: 2 } },
    });
    assert.equal(state.undefinedReturn, true);
    assert.deepEqual(state.functionReturn, { type: 'function', value: 9 });
    assert.deepEqual(state.thrown, {
      name: 'TypeError', message: 'edge-throw', isError: true, isTypeError: false,
    });
    assert.deepEqual(state.returnedError, {
      name: 'RangeError', message: 'edge-return', isError: true, isTypeError: false,
    });
    for (const item of state.unsupportedArgs) {
      assert.equal(item.rejected, true, `unsupported argument ${item.label} was accepted`);
      assert.match(item.error.code, /^ELECTRON_MBT_BRIDGE_VALUE_/);
    }
    for (const item of state.unsupportedReturns) {
      assert.equal(item.rejected, true, `unsupported return ${item.name} was accepted`);
      assert.match(item.error.code, /^ELECTRON_MBT_BRIDGE_VALUE_/);
    }
    assert.equal(state.promise.isPromise, true);
    assert.equal(state.promise.value, 43);
    assert.equal(state.promiseRejection.name, 'RangeError');
    assert.equal(state.promiseRejection.message, 'edge-reject');
    assert.equal(state.promiseRejection.isError, true);
    assert.equal(state.promiseUnsupported.rejected, true);
    assert.equal(state.promiseUnsupported.name, 'BridgeCodecError');
    assert.match(state.promiseUnsupported.code, /^ELECTRON_MBT_BRIDGE_VALUE_/);
    assert.deepEqual(state.thenable, { isPromise: true, value: 11 });
    assert.deepEqual(state.thenableDouble, { value: 12 });
    assert.deepEqual(state.callbackValues, ['first', 'second']);
    assert.deepEqual(state.subscription, {
      values: ['sub-first'], disposerType: 'function', firstDispose: true, secondDispose: false,
    });
    assert.deepEqual(state.nested, { value: 'nested' });
    assert.equal(state.callResult, 42);
    assert.deepEqual(state.callbackFunction, { value: 33 });
    assert.equal(state.callbackThrow.isError, true);
    assert.equal(state.callbackThrow.message, 'edge-callback');
    assert.equal(state.callbackPromise.name, 'BridgeCodecError');
    assert.match(state.callbackPromise.code, /^ELECTRON_MBT_BRIDGE_VALUE_/);
    assert.ok(exposures.some(event => event.window === window.id &&
      event.payload?.apiKey === 'fixture' && event.payload.functionCount >= 20));

    await window.loadFile('edge.html');
    await waitFor(() => reports.filter(event => event.window === window.id).length >= 2,
      'edge reload report');
    await waitFor(() => runtime.core.context_bridge_exposure_count(runtime.runtime) === 1,
      'edge reload exposure');
    const reload = reports.filter(event => event.window === window.id).at(-1);
    assert.equal(reload.payload.value.fixtureError, null);
    assert.equal(reload.payload.value.undefinedReturn, true);
    window.destroy();
    await waitFor(() => runtime.core.context_bridge_exposure_count(runtime.runtime) === 0,
      'edge exposure revocation');
    assert.equal(snapshot(fixtureRoot).sha256, before);
    console.log(JSON.stringify({
      probe: 'b6-context-bridge-semantics', status: 'PASS',
      unsupportedArgsRejected: state.unsupportedArgs.length,
      unsupportedReturnsRejected: state.unsupportedReturns.length,
      callbacks: true, nestedReentrant: true, promiseAssimilation: true,
      reloadObservation: true, exposureRegistered: true,
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
