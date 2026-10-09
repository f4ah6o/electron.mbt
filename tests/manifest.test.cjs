'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const manifest = require('../compatibility/manifest.json');
const root = path.resolve(__dirname, '..');
test('unmet acceptance gates cannot be reported as verified', () => {
  assert.equal(manifest.compatible, false);
  assert.deepEqual(manifest.rows.map(row => row.id), [...'ABCDEFGHIJ']);
  assert.equal(manifest.valueProfile.structuredCloneCompatible, false);
  for (const row of manifest.rows) {
    assert.ok(['planned', 'partial', 'verified', 'unsupported'].includes(row.status));
    if (row.status === 'verified') assert.ok(row.evidence.length > 0, row.id);
    assert.ok(row.gap.length > 0);
    for (const file of row.tests) assert.ok(fs.existsSync(path.join(root, file)), file);
  }
  assert.equal(manifest.gates.syncIsolatedContextBridge, 'open');
});
test('unimplemented run and pack reject without executing app code', () => {
  for (const command of ['run', 'pack']) {
    const result = spawnSync(process.execPath, ['cmd/electron-mbt.cjs', command, 'a-nonexistent-app'], { cwd: root, encoding: 'utf8' });
    assert.equal(result.status, 1);
    const output = JSON.parse(result.stdout);
    assert.equal(output.compatible, false);
    assert.equal(output.code, 'ELECTRON_MBT_M0_INCOMPLETE');
  }
});
test('snapshot CLI records the same unchanged files across invocations', () => {
  const run = () => spawnSync(process.execPath, ['cmd/electron-mbt.cjs', 'snapshot', 'fixtures/cjs'], { cwd: root, encoding: 'utf8' });
  const first = run(); const second = run();
  assert.equal(first.status, 0); assert.equal(second.status, 0);
  assert.equal(JSON.parse(first.stdout).sha256, JSON.parse(second.stdout).sha256);
});
