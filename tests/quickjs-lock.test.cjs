'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const lock = JSON.parse(fs.readFileSync(path.join(root, 'vendor/quickjs/lock.json'), 'utf8'));
const packageDir = path.join(root, 'bridges/embedded-js');

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

test('QuickJS source and license match the pinned vendor lock', () => {
  assert.equal(lock.schema, 1);
  assert.equal(lock.engine, 'quickjs');
  assert.equal(lock.version, '2026-06-04');
  assert.equal(lock.tarballSha256, 'b376e839b322978313d929fd20663b11ba58b75df5a46c126dd19ea2fa70ad2a');
  assert.equal(lock.license.expression, 'MIT');
  assert.equal(sha256(path.join(root, lock.license.file)), lock.license.sha256);
  for (const [name, expected] of Object.entries(lock.files)) {
    const file = path.join(packageDir, name);
    assert.ok(fs.existsSync(file), `missing vendored QuickJS file ${name}`);
    assert.equal(sha256(file), expected, `vendor hash mismatch for ${name}`);
  }
});

test('the native build includes only the pinned engine core, not qjs/libc helpers', () => {
  const vendorFiles = new Set(Object.keys(lock.files));
  const packageFiles = fs.readdirSync(packageDir).filter((name) => /\.(?:c|h)$/.test(name));
  for (const name of packageFiles) {
    if (name === 'quickjs_adapter.c') continue;
    assert.ok(vendorFiles.has(name), `unexpected non-pinned C source ${name}`);
  }
  assert.equal(packageFiles.includes('quickjs-libc.c'), false);
  assert.equal(packageFiles.includes('qjs.c'), false);
  assert.equal(packageFiles.includes('qjsc.c'), false);
});

test('the QuickJS package is native-only and declares its native stubs', () => {
  const pkg = fs.readFileSync(path.join(packageDir, 'moon.pkg'), 'utf8');
  assert.match(pkg, /"native-stub"/);
  assert.match(pkg, /quickjs_adapter\.c/);
  assert.match(pkg, /quickjs\.c/);
  assert.match(pkg, /targets:/);
  assert.match(pkg, /engine\.mbt.*native/);
});
