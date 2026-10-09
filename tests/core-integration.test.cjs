'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
// A missing compiled core is a failing build precondition, never a skipped PASS.
const core = require('../dist/core.cjs');
const root = path.resolve(__dirname, '..');
test('the compiled MoonBit boundary owns lifecycle transitions', () => {
  const runtime = core.new_runtime();
  const call = operation => JSON.parse(core.dispatch(runtime, operation));
  assert.equal(call('state').state, 'Booting');
  assert.equal(call('cancel-quit').code, 'InvalidState');
  assert.equal(call('ready').ok, true);
  assert.equal(call('ready').code, 'InvalidState');
  assert.equal(call('begin-quit').ok, true);
  assert.equal(call('cancel-quit').ok, true);
  assert.equal(call('state').state, 'Ready');
  assert.equal(call('stop').ok, true);
  assert.equal(call('ready').code, 'InvalidState');
  assert.equal(call('missing').code, 'ELECTRON_MBT_UNSUPPORTED_API');
});
test('the compiled diagnostic never upgrades incomplete M0 to compatible', () => {
  const output = JSON.parse(core.diagnose(JSON.stringify({ entryType: 'commonjs', nativeAddons: false, platform: 'darwin' })));
  assert.equal(output.compatible, false);
  assert.deepEqual(output.diagnostics, ['ELECTRON_MBT_M0_INCOMPLETE']);
  assert.equal(JSON.parse(core.diagnose('{')).code, 'ELECTRON_MBT_INVALID_METADATA');
  assert.equal(JSON.parse(core.diagnose('x'.repeat(16385))).code, 'ELECTRON_MBT_LIMIT');
});
test('doctor and compat-check return structured non-success without evaluating main', () => {
  for (const command of ['doctor', 'compat-check']) {
    const result = spawnSync(process.execPath, ['cmd/electron-mbt.cjs', command, 'fixtures/cjs'], { cwd: root, encoding: 'utf8' });
    assert.equal(result.status, 2, result.stderr || result.stdout);
    const report = JSON.parse(result.stdout);
    assert.equal(report.compatible, false);
    assert.equal(report.app.name, 'electron-mbt-cjs-fixture');
    assert.match(report.app.sourceHash, /^[a-f0-9]{64}$/);
    assert.ok(report.diagnostics.includes('ELECTRON_MBT_M0_INCOMPLETE'));
  }
});
