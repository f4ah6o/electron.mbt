'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { inspectApp, snapshot } = require('../bridges/node/app-files.cjs');
const { installElectronFacade, loadCjs } = require('../bridges/node/cjs-loader.cjs');
function temp(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'electron-mbt-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}
test('the app and a dependency resolve one facade without modifying sources', t => {
  const root = temp(t);
  const app = path.join(root, 'app');
  fs.cpSync(path.join(__dirname, '../fixtures/cjs'), app, { recursive: true });
  const facade = path.join(root, 'facade.cjs');
  fs.writeFileSync(facade, 'module.exports = Object.freeze({ marker: "probe-only" });');
  const before = snapshot(app);
  const hooks = installElectronFacade(facade);
  t.after(() => hooks.deregister());
  const result = loadCjs(inspectApp(app).entry);
  assert.equal(result.identity, true);
  assert.equal(result.electron.marker, 'probe-only');
  assert.equal(snapshot(app).sha256, before.sha256);
  assert.throws(() => require('electron/main'), { code: 'ELECTRON_MBT_UNSUPPORTED_API' });
});
test('ESM imports are not silently reported as CJS compatibility', async t => {
  const root = temp(t);
  const facade = path.join(root, 'facade.cjs');
  fs.writeFileSync(facade, 'module.exports = {};');
  const hooks = installElectronFacade(facade);
  t.after(() => hooks.deregister());
  await assert.rejects(import('electron'), { code: 'ELECTRON_MBT_UNSUPPORTED_API' });
});
test('entry traversal and symlink escapes are rejected', t => {
  const root = temp(t);
  const app = path.join(root, 'app'); fs.mkdirSync(app);
  fs.writeFileSync(path.join(app, 'package.json'), '{"main":"../outside.cjs"}');
  fs.writeFileSync(path.join(root, 'outside.cjs'), 'module.exports = 1;');
  assert.throws(() => inspectApp(app), { code: 'ELECTRON_MBT_PATH_ESCAPE' });
  fs.writeFileSync(path.join(app, 'package.json'), '{"main":"main.cjs"}');
  fs.symlinkSync(path.join(root, 'outside.cjs'), path.join(app, 'main.cjs'));
  assert.throws(() => inspectApp(app), { code: 'ELECTRON_MBT_PATH_ESCAPE' });
});
test('directory symlink cycles fail rather than hanging the inventory', t => {
  const root = temp(t);
  fs.symlinkSync(root, path.join(root, 'cycle'));
  assert.throws(() => snapshot(root), { code: 'ELECTRON_MBT_SYMLINK_CYCLE' });
});
test('nearest package type and native addons are observed without evaluating main', t => {
  const root = temp(t); fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'package.json'), '{"main":"src/main.js"}');
  fs.writeFileSync(path.join(root, 'src/package.json'), '{"type":"module"}');
  fs.writeFileSync(path.join(root, 'src/main.js'), 'throw new Error("must not execute");');
  fs.writeFileSync(path.join(root, 'addon.node'), 'not an addon');
  const report = inspectApp(root);
  assert.equal(report.entryType, 'module');
  assert.equal(report.nativeAddons, true);
});

test('oversized sparse files are rejected before reading their contents', t => {
  const root = temp(t);
  const file = path.join(root, 'oversized.bin');
  const fd = fs.openSync(file, 'w');
  fs.ftruncateSync(fd, 33554433); fs.closeSync(fd);
  assert.throws(() => snapshot(root), { code: 'ELECTRON_MBT_LIMIT' });
});
test('directory symlink targets participate in the source snapshot', t => {
  const root = temp(t);
  fs.mkdirSync(path.join(root, 'empty-a')); fs.mkdirSync(path.join(root, 'empty-b'));
  fs.symlinkSync('empty-a', path.join(root, 'alias'));
  const first = snapshot(root);
  fs.unlinkSync(path.join(root, 'alias')); fs.symlinkSync('empty-b', path.join(root, 'alias'));
  const second = snapshot(root);
  assert.notEqual(first.sha256, second.sha256);
});

test('top-level .git files participate in the source snapshot', t => {
  const root = temp(t);
  const gitDir = path.join(root, '.git');
  fs.mkdirSync(gitDir);
  const runtimeFile = path.join(gitDir, 'runtime-used.txt');
  fs.writeFileSync(runtimeFile, 'first runtime input\n');
  const first = snapshot(root);
  assert.ok(first.files.some(file => file.path === '.git/runtime-used.txt'));
  fs.writeFileSync(runtimeFile, 'second runtime input\n');
  const second = snapshot(root);
  assert.notEqual(first.sha256, second.sha256);
});
