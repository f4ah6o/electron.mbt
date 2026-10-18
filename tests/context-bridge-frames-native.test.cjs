'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { inspectApp } = require('../bridges/node/app-files.cjs');

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

test('What: B7 frame policy keeps child frames out of the main-frame bridge', {
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
  const reports = [];
  runtime.host.on('preload-report', event => reports.push(event));
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
    await window.loadFile('frame.html');
    await waitFor(() => reports.some(event => event.window === window.id &&
      event.payload?.channel === 'edge:report'), 'frame report');
    const report = reports.find(event => event.window === window.id &&
      event.payload?.channel === 'edge:report');
    const state = report.payload.value;
    assert.equal(state.fixtureError, null);
    assert.equal(state.parentApi, true);
    assert.equal(state.echo, 5);
    // The M1 host's navigation policy cancels every subframe navigation, so
    // both child frames are absent and cannot receive or reach the bridge.
    assert.equal(state.same, null, 'same-origin child must not load');
    assert.equal(state.sandbox, null, 'sandboxed child must not load');
    const transportHandlers = [
      'electronMbtPreloadResult', 'electronMbtPreloadExposure',
      'electronMbtM0CbDocument', 'electronMbtM0CbReport',
    ];
    for (const handler of transportHandlers) {
      assert.equal((state.parentHandlers || []).includes(handler), false,
        `main frame must not see ${handler}`);
    }
    console.log(JSON.stringify({
      probe: 'b7-context-bridge-frames', status: 'PASS',
      parentApi: true, frameNavigation: 'main-frame-only',
      sameOriginChild: 'blocked', sandboxChild: 'blocked',
      transportHandlersHidden: true,
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
