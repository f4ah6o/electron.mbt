'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { NativeHost } = require('../bridges/node/native-host.cjs');
const { snapshot } = require('../bridges/node/app-files.cjs');

async function main() {
  if (process.platform !== 'darwin') throw new Error('ELECTRON_MBT_UNSUPPORTED_PLATFORM');
  const root = path.resolve(__dirname, '../fixtures/m1');
  const before = snapshot(root).sha256;
  const host = new NativeHost(root, { watchdogMs: 15000 });
  let closed = false;
  try {
    const hello = host.request('hello');
    assert.equal(hello.backend, 'AppKit+WKWebView');
    assert.ok(Number.isInteger(hello.pid) && hello.pid > 0);
    assert.equal(host.request('ready').backend, 'AppKit+WKWebView');
    const created = host.request('create-window', 1, 0, {
      width: 640, height: 480, title: 'electron.mbt M1 native smoke', show: false,
    });
    assert.equal(created.webViewAttached, true);
    assert.equal(created.visible, false);
    const loaded = host.request('load-file', 1, 1, {
      file: path.join(root, 'index.html'),
    });
    assert.equal(loaded.didFinishLoad, true);
    assert.match(loaded.url, /^file:\/\//);
    assert.equal(host.request('show-window', 1, 1).visible, true);
    assert.throws(() => host.request('load-file', 1, 1, {
      file: path.join(root, 'index.html'),
    }), { code: 'ELECTRON_MBT_FILE_OR_GENERATION_DENIED' });
    assert.throws(() => host.request('load-file', 1, 2, {
      file: path.resolve(root, '../oracle/index.html'),
    }), { code: 'ELECTRON_MBT_FILE_OR_GENERATION_DENIED' });
    assert.equal(host.request('destroy-window', 1, 1).destroyed, true);
    assert.throws(() => host.request('show-window', 1, 1), {
      code: 'ELECTRON_MBT_WINDOW_UNKNOWN',
    });
    host.close();
    closed = true;
    assert.equal(snapshot(root).sha256, before);
    console.log(JSON.stringify({
      status: 'PASS', probe: 'm1-native-host-lifecycle',
      backend: hello.backend, childPid: hello.pid, builtWindow: true,
      loadDidFinish: true, symlinkEscapeRejected: true,
      staleGenerationRejected: true, destroyed: true,
      sourceHashPreserved: true, compatible: false,
    }));
  } finally {
    if (!closed) host.abort();
  }
}
main().catch((error) => {
  console.error(error.code || error.message);
  process.exitCode = 1;
});
