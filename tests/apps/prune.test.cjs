'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pruneApp } = require('../../scripts/app-prune.cjs');

function temp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'electron-mbt-prune-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function fixture(t) {
  const app = temp(t);
  fs.writeFileSync(path.join(app, 'package.json'), JSON.stringify({ name: 'prune-fixture', version: '1.0.0' }));
  fs.writeFileSync(path.join(app, 'package-lock.json'), JSON.stringify({
    lockfileVersion: 3,
    packages: {
      '': { name: 'prune-fixture', version: '1.0.0', dependencies: { prod: '1.0.0' }, devDependencies: { dev: '1.0.0' } },
      'node_modules/prod': { version: '1.0.0' },
      'node_modules/dev': { version: '1.0.0', dev: true },
    },
  }));
  fs.mkdirSync(path.join(app, 'out'), { recursive: true });
  fs.writeFileSync(path.join(app, 'out/main.js'), 'console.log("main")');
  fs.mkdirSync(path.join(app, 'node_modules/prod'), { recursive: true });
  fs.writeFileSync(path.join(app, 'node_modules/prod/index.js'), 'module.exports = 1');
  fs.writeFileSync(path.join(app, 'node_modules/prod/addon.node'), '');
  fs.mkdirSync(path.join(app, 'node_modules/dev'), { recursive: true });
  fs.writeFileSync(path.join(app, 'node_modules/dev/index.js'), 'dev');
  return app;
}

test('production closure includes prod packages and excludes dev packages', (t) => {
  const app = fixture(t);
  const out = temp(t);
  const closure = pruneApp({ appRoot: app, outRoot: out, appId: 'prune-fixture' });
  assert.equal(closure.status, 'PASS');
  assert.equal(closure.appId, 'prune-fixture');
  assert.ok(fs.existsSync(path.join(out, 'node_modules/prod/index.js')));
  assert.equal(fs.existsSync(path.join(out, 'node_modules/dev')), false);
  assert.equal(closure.productionPackages.length, 1);
  assert.equal(closure.excludedDevCount, 1);
  assert.deepEqual(closure.nativeAddons, ['node_modules/prod/addon.node']);
  assert.match(closure.appFileHash, /^[a-f0-9]{64}$/);
  assert.match(closure.packageFileHash, /^[a-f0-9]{64}$/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(out, 'closure.json'), 'utf8')).status, 'PASS');
});

test('output must be empty or absent and must not overlap the source', (t) => {
  const app = fixture(t);
  const out = temp(t);
  fs.writeFileSync(path.join(out, 'occupied'), 'x');
  assert.throws(() => pruneApp({ appRoot: app, outRoot: out }), /must be empty or absent/);
  assert.throws(() => pruneApp({ appRoot: app, outRoot: path.join(app, 'nested') }), /must not overlap/);
});

test('symlinks and unsupported lock versions fail closed', (t) => {
  const app = fixture(t);
  fs.symlinkSync(path.join(app, 'package.json'), path.join(app, 'linked.json'));
  assert.throws(() => pruneApp({ appRoot: app, outRoot: temp(t) }), /symlink is not allowed/);
  const second = fixture(t);
  const lock = JSON.parse(fs.readFileSync(path.join(second, 'package-lock.json'), 'utf8'));
  lock.lockfileVersion = 2;
  fs.writeFileSync(path.join(second, 'package-lock.json'), JSON.stringify(lock));
  assert.throws(() => pruneApp({ appRoot: second, outRoot: temp(t) }), /lockfileVersion 3/);
});

test('a missing non-optional production package is an error', (t) => {
  const app = fixture(t);
  fs.rmSync(path.join(app, 'node_modules/prod'), { recursive: true, force: true });
  assert.throws(() => pruneApp({ appRoot: app, outRoot: temp(t) }), /production package is not installed/);
});
