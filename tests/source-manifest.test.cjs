'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { buildSourceManifest } = require('../scripts/source-manifest.cjs');

test('the committed source manifest matches the fixture entry', () => {
  const root = path.resolve(__dirname, '../fixtures/native-app');
  const committed = JSON.parse(fs.readFileSync(path.join(root, 'source-manifest.json'), 'utf8'));
  assert.deepEqual(buildSourceManifest(root, 'index.html', 'native-app-fixture'), committed);
});

test('the source manifest builder rejects escapes, missing, non-regular and symlink entries', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'electron-mbt-source-manifest-'));
  const outsideRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'electron-mbt-source-outside-'));
  try {
    fs.writeFileSync(path.join(root, 'index.html'), 'fixture');
    assert.equal(buildSourceManifest(root, 'index.html').entry, 'index.html');
    assert.throws(() => buildSourceManifest(root, '../escape.html'), /invalid entry/);
    assert.throws(() => buildSourceManifest(root, path.join(root, 'index.html')), /invalid entry/);
    assert.throws(() => buildSourceManifest(root, 'missing.html'), /does not exist/);
    fs.mkdirSync(path.join(root, 'directory'));
    assert.throws(() => buildSourceManifest(root, 'directory'), /regular file/);
    const outside = path.join(outsideRoot, 'outside.html');
    fs.writeFileSync(outside, 'outside');
    fs.symlinkSync(outside, path.join(root, 'link.html'));
    assert.throws(() => buildSourceManifest(root, 'link.html'), /escapes root/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outsideRoot, { recursive: true, force: true });
  }
});
