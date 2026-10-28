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
test('the compiled boundary carries the window/document/request surface', () => {
  const runtime = core.new_runtime();
  const call = op => JSON.parse(core.dispatch(runtime, JSON.stringify(op)));
  JSON.parse(core.dispatch(runtime, 'ready'));
  const window = call({ op: 'window.reserve' }).window;
  const padded = JSON.parse(core.dispatch(runtime, ` \n\t${JSON.stringify({ op: 'window.reserve' })}`));
  assert.equal(typeof padded.window, 'number', 'insignificant whitespace must not downgrade an envelope to a bare op');
  assert.equal(call({ op: 'window.destroy', window: padded.window }).destroyed, true);
  assert.equal(call({ op: 'window.state', window }).state, 'Creating');
  assert.equal(call({ op: 'window.navigate', window }).code, 'InvalidState');
  assert.equal(call({ op: 'window.confirm', window }).ok, true);
  const generation = call({ op: 'window.navigate', window }).generation;
  assert.equal(call({ op: 'document.activate', window, generation, host_origin: '' }).code, 'Denied');
  assert.equal(call({ op: 'document.activate', window, generation, host_origin: 'https://app.local' }).ok, true);
  assert.equal(call({ op: 'document.activate', window, generation, host_origin: 'https://app.local' }).code, 'InvalidState');
  assert.equal(call({ op: 'grant', window, generation, channel: 'fixture:read' }).ok, true);
  assert.equal(call({ op: 'authorize', window, generation, host_origin: 'https://app.local', main_frame: false, channel: 'fixture:read' }).code, 'Denied');
  assert.equal(call({ op: 'authorize', window, generation, host_origin: 'https://app.local', main_frame: true, channel: 'fixture:read' }).ok, true);
  const request = call({ op: 'request.begin', window, generation, host_origin: 'https://app.local', main_frame: true, channel: 'fixture:read', payload_bytes: 4 }).request;
  assert.equal(call({ op: 'pending' }).pending, 1);
  assert.equal(call({ op: 'queued-bytes' }).bytes, 4);
  assert.equal(call({ op: 'request.complete', request, window, generation }).ok, true);
  assert.equal(call({ op: 'request.complete', request, window, generation }).code, 'AlreadyCompleted');
  assert.equal(call({ op: 'window.begin-close', window }).ok, true);
  assert.equal(call({ op: 'window.cancel-close', window }).ok, true);
  const next = call({ op: 'window.navigate', window }).generation;
  assert.equal(next, generation + 1);
  assert.equal(call({ op: 'window.destroy', window }).destroyed, true);
  assert.equal(call({ op: 'window.destroy', window }).destroyed, false);
  assert.equal(call({ op: 'preferences.validate', node_integration: false, context_isolation: true, sandbox: true, web_security: true }).valid, true);
  assert.equal(call({ op: 'preferences.validate', node_integration: true, context_isolation: true, sandbox: true, web_security: true }).valid, false);
});
test('malformed envelopes and missing arguments fail with typed diagnostics', () => {
  const runtime = core.new_runtime();
  const raw = op => JSON.parse(core.dispatch(runtime, op));
  assert.equal(raw('{').code, 'InvalidPayload');
  assert.equal(raw(' \n{').code, 'InvalidPayload');
  assert.equal(raw('   ').code, 'ELECTRON_MBT_UNSUPPORTED_API');
  assert.equal(raw(' state').code, 'ELECTRON_MBT_UNSUPPORTED_API');
  assert.equal(raw(`${JSON.stringify({ op: 'pending' })} \n`).ok, true);
  assert.equal(raw(JSON.stringify({ op: 'window.confirm' })).code, 'InvalidPayload');
  assert.equal(raw(JSON.stringify({ op: 'window.confirm', window: 'x' })).code, 'InvalidPayload');
  assert.equal(raw(JSON.stringify({ op: 'window.confirm', window: 1.5 })).code, 'InvalidPayload');
  assert.equal(raw(JSON.stringify({ op: 'window.confirm', window: 4294967296 })).code, 'InvalidPayload');
  assert.equal(raw(JSON.stringify({ op: 'unknown.op' })).code, 'ELECTRON_MBT_UNSUPPORTED_API');
  assert.equal(raw(`{"op":"${'x'.repeat(16400)}"}`).code, 'InvalidPayload');
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
    const result = spawnSync(process.execPath, ['cmd/legacy-node.cjs', command, 'fixtures/cjs'], { cwd: root, encoding: 'utf8' });
    assert.equal(result.status, 2, result.stderr || result.stdout);
    const report = JSON.parse(result.stdout);
    assert.equal(report.compatible, false);
    assert.equal(report.app.name, 'electron-mbt-cjs-fixture');
    assert.match(report.app.sourceHash, /^[a-f0-9]{64}$/);
    assert.ok(report.diagnostics.includes('ELECTRON_MBT_M0_INCOMPLETE'));
  }
});
