'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { inspectApp } = require('../bridges/node/app-files.cjs');

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

test('What: B7 page self-DoS does not block native control', {
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
    const loading = window.loadFile('dos.html').catch(() => {});
    await sleep(500);
    assert.equal(window._loading, true, 'the page load must still be in flight');
    const title = runtime.host.request('get-web-contents-title', window.id, window._generation);
    const preload = runtime.host.request('get-preload-status', window.id, window._generation);
    // The page's busy script prevents title/load completion, but the native
    // control lane still answers both requests instead of blocking on page JS.
    assert.equal(typeof title.title, 'string');
    assert.ok(['ok', 'failed', 'absent'].includes(preload.status));
    console.log(JSON.stringify({
      probe: 'b7-page-self-dos', status: 'PASS',
      pageScriptBlocked: true, nativeTitleResponsive: true,
      preloadStatusResponsive: true, preloadStatus: preload.status,
      pageTitle: title.title,
      compatible: false, contextBridge: 'NOT_IMPLEMENTED',
      productionContextBridge: 'NOT_IMPLEMENTED',
    }));
    void loading;
  } finally {
    runtime.abort();
    if (previousBridge === undefined) delete process.env.ELECTRON_MBT_B6_PRELOAD_BRIDGE;
    else process.env.ELECTRON_MBT_B6_PRELOAD_BRIDGE = previousBridge;
    if (previousTransport === undefined) delete process.env.ELECTRON_MBT_B6_TRANSPORT;
    else process.env.ELECTRON_MBT_B6_TRANSPORT = previousTransport;
  }
});
