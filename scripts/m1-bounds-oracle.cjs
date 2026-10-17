'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const manifest = require('../compatibility/manifest.json');

const evidence = path.resolve(__dirname, '../evidence');
const baseline = JSON.parse(fs.readFileSync(path.join(evidence, 'electron-baseline.json'), 'utf8'));
assert.equal(baseline.status, 'baseline-collected');
assert.equal(baseline.observed.versions.electron, manifest.versions.electronOracle);
const reference = baseline.observed.initialOuterBounds;
assert.deepEqual(reference, { width: 640, height: 480 },
  'Pinned Electron default useContentSize:false must expose 640x480 outer bounds');

const lines = fs.readFileSync(path.join(evidence, 'native-host-smoke.log'), 'utf8').split(/\r?\n/);
const native = lines.map(line => {
  try { return JSON.parse(line); } catch { return null; }
}).find(entry => entry && entry.probe === 'm1-native-host-lifecycle');
assert.equal(native?.status, 'PASS', 'Real AppKit smoke evidence is required');
assert.deepEqual(native.initialOuterBounds, reference,
  'Native initial outer dimensions must equal the pinned Electron oracle');
console.log(JSON.stringify({
  probe: 'm1-native-outer-bounds-vs-pinned-electron',
  status: 'PASS',
  electronVersion: manifest.versions.electronOracle,
  reference, native: native.initialOuterBounds,
  compatible: false,
}));
