'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const { inspectApp, snapshot } = require('../bridges/node/app-files.cjs');
const { installElectronFacade, loadCjs } = require('../bridges/node/cjs-loader.cjs');
const root = path.resolve(__dirname, '..');
const facade = path.join(root, 'bridges/node/electron-facade.cjs');
function temp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'electron-mbt-facade-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
function runFixture(t, context, extraEnv = {}) {
  const dir = temp(t);
  const app = path.join(dir, 'app');
  fs.cpSync(path.join(root, 'fixtures/facade'), app, { recursive: true });
  const entry = inspectApp(app).entry;
  const before = snapshot(app);
  const bootstrap = [
    `const { installElectronFacade, loadCjs } = require(${JSON.stringify(path.join(root, 'bridges/node/cjs-loader.cjs'))});`,
    `installElectronFacade(${JSON.stringify(facade)});`,
    `loadCjs(${JSON.stringify(entry)});`,
  ].join('\n');
  const env = { ...process.env, ...extraEnv };
  if (context !== null) env.ELECTRON_MBT_FACADE_CONTEXT = JSON.stringify(context);
  else delete env.ELECTRON_MBT_FACADE_CONTEXT;
  const result = spawnSync(process.execPath, ['-e', bootstrap], { cwd: root, env, encoding: 'utf8', timeout: 30000 });
  assert.equal(snapshot(app).sha256, before.sha256, 'the fixture must run without source changes');
  return result;
}
function trace(result) {
  const lines = result.stdout.split(/\r?\n/).filter(line => line.startsWith('ELECTRON_MBT_FACADE='));
  assert.equal(lines.length, 1, result.stderr || result.stdout);
  return JSON.parse(lines[0].slice('ELECTRON_MBT_FACADE='.length));
}
test('the facade declares the app surface and fails closed on unimplemented APIs', t => {
  const userData = path.join(temp(t), 'userdata');
  const appRoot = path.join(root, 'fixtures/facade');
  const result = runFixture(t, { root: appRoot, name: 'electron-mbt-facade-fixture', version: '0.1.0', userData },
    { ELECTRON_MBT_TEST_ROOT: appRoot, ELECTRON_MBT_TEST_USERDATA: userData });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const observed = trace(result);
  assert.deepEqual(observed, [
    ['module-identity', true],
    ['isReady-before', false],
    ['browserwindow', 'ELECTRON_MBT_UNSUPPORTED_API'],
    ['contextbridge', 'ELECTRON_MBT_UNSUPPORTED_API'],
    ['ipcmain-handle', 'ELECTRON_MBT_UNSUPPORTED_API'],
    ['getPath-unknown', 'ELECTRON_MBT_INVALID_ARGUMENT'],
    ['getName', 'electron-mbt-facade-fixture'],
    ['getVersion', '0.1.0'],
    ['isPackaged', false],
    ['getAppPath', true],
    ['userData', true],
    ['whenReady-resolved', true],
    ['before-quit'],
    ['alive-after-cancelled-quit', true],
    ['before-quit'],
    ['will-quit'],
    ['quit'],
  ]);
});
test('require(\'electron\') fails closed without a launch context', t => {
  const result = runFixture(t, null);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /ELECTRON_MBT_NOT_LAUNCHED/);
});
test('a malformed launch context is rejected as typed metadata', t => {
  const dir = temp(t);
  const app = path.join(dir, 'app');
  fs.cpSync(path.join(root, 'fixtures/facade'), app, { recursive: true });
  const hooks = installElectronFacade(facade);
  t.after(() => hooks.deregister());
  process.env.ELECTRON_MBT_FACADE_CONTEXT = '{';
  t.after(() => { delete process.env.ELECTRON_MBT_FACADE_CONTEXT; });
  assert.throws(() => loadCjs(inspectApp(app).entry), { code: 'ELECTRON_MBT_INVALID_METADATA' });
});
