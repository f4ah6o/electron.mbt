'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { snapshot } = require('../bridges/node/app-files.cjs');

if (process.platform !== 'darwin') throw new Error('M1 native app smoke requires macOS');
const root = path.resolve(__dirname, '../fixtures/m1-app');
const before = snapshot(root).sha256;
const result = spawnSync(process.execPath, [
  path.resolve(__dirname, '../cmd/electron-mbt.cjs'),
  'run', root, '--experimental-m1',
], { encoding: 'utf8', timeout: 40000, maxBuffer: 1024 * 1024 });
if (result.error) throw result.error;
assert.equal(result.status, 0, result.stderr || result.stdout);
const output = result.stdout.split('\n').find(line => line.includes('"fixture":"m1-cjs"'));
assert.ok(output, 'unchanged Electron CJS main must complete');
const observed = JSON.parse(output);
assert.equal(observed.status, 'PASS');
assert.equal(observed.realWebViewLoaded, true);
assert.equal(observed.closeCancelled, true);
assert.equal(observed.destroyForced, true);
assert.equal(observed.nativeVisibilityRoundTrip, true);
assert.equal(snapshot(root).sha256, before);
console.log(JSON.stringify({
  probe: 'm1-unchanged-cjs-app', status: 'PASS',
  mainUnmodified: true, sourceHashPreserved: true,
  backend: 'AppKit+WKWebView', compatible: false,
}));
