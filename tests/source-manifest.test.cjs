'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { buildSourceManifest } = require('../scripts/source-manifest.cjs');

test('the committed source manifest matches the fixture entry and adapter', () => {
  const root = path.resolve(__dirname, '../fixtures/native-app');
  const committed = JSON.parse(fs.readFileSync(path.join(root, 'source-manifest.json'), 'utf8'));
  const files = [
    'index.html',
    'adapted/page-api.js',
    'package.json',
    'src/main.js',
    'src/lib/index.js',
    'src/lib/greet.js',
    'src/lib/data.json',
    'src/lib/scenario.js',
    'node_modules/fixture-pkg/package.json',
    'node_modules/fixture-pkg/cjs.js',
    'node_modules/fixture-pkg/index.js',
  ];
  assert.deepEqual(
    buildSourceManifest(root, 'index.html', 'native-app-fixture', files),
    committed,
  );
  assert.equal(committed.schema, 2);
  assert.deepEqual(committed.files.map(file => file.path), files);
});

test('the source manifest builder orders the entry first and rejects escapes and duplicates', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'electron-mbt-source-manifest-'));
  const outsideRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'electron-mbt-source-outside-'));
  try {
    fs.writeFileSync(path.join(root, 'index.html'), 'fixture');
    fs.mkdirSync(path.join(root, 'adapted'));
    fs.writeFileSync(path.join(root, 'adapted', 'page-api.js'), 'adapter');
    const manifest = buildSourceManifest(root, 'index.html', 'source-probe', [
      'adapted/page-api.js', 'index.html',
    ]);
    assert.equal(manifest.schema, 2);
    assert.deepEqual(manifest.files.map(file => file.path), ['index.html', 'adapted/page-api.js']);
    assert.throws(() => buildSourceManifest(root, '../escape.html'), /invalid file path/);
    assert.throws(() => buildSourceManifest(root, path.join(root, 'index.html')), /invalid file path/);
    assert.throws(() => buildSourceManifest(root, 'missing.html'), /does not exist/);
    fs.mkdirSync(path.join(root, 'directory'));
    assert.throws(() => buildSourceManifest(root, 'directory'), /not regular/);
    const outside = path.join(outsideRoot, 'outside.html');
    fs.writeFileSync(outside, 'outside');
    fs.symlinkSync(outside, path.join(root, 'link.html'));
    assert.throws(() => buildSourceManifest(root, 'link.html'), /escapes root/);
    assert.throws(() => buildSourceManifest(root, 'index.html', 'source-probe', [
      'index.html', 'index.html',
    ]), /duplicate file/);
    assert.throws(() => buildSourceManifest(root, 'index.html', 'source-probe', [
      'adapted/page-api.js',
    ]), /entry must be listed/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outsideRoot, { recursive: true, force: true });
  }
});
