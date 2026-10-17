'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const manifestV1 = require('../compatibility/manifest.json');
const profiles = require('../compatibility/runtime-profiles-v1.json');
const { migrateManifestV1, validateManifestV2, ROW_IDS, PROFILE_IDS } = require('../scripts/manifest-v2.cjs');
const root = path.resolve(__dirname, '..');

function migrated() {
  return migrateManifestV1(manifestV1, profiles);
}

test('schema-1 manifest migrates without upgrading any claim', () => {
  const value = migrated();
  assert.equal(value.schema, 2);
  assert.equal(value.compatible, false);
  assert.deepEqual(value.rows.map((row) => row.id), ROW_IDS);
  assert.deepEqual(Object.keys(value.profiles).sort(), [...PROFILE_IDS].sort());
  for (const row of value.rows) {
    assert.notEqual(row.verification, 'passed');
    assert.notEqual(row.gate, 'satisfied');
    assert.ok(row.gap.length > 0);
    assert.ok(Array.isArray(row.tests));
    assert.ok(Array.isArray(row.evidence));
  }
  const sourceA = manifestV1.rows.find((row) => row.id === 'A');
  const targetA = value.rows.find((row) => row.id === 'A');
  assert.equal(targetA.area, sourceA.scope);
  assert.deepEqual(targetA.tests, sourceA.tests);
  assert.deepEqual(targetA.evidence, sourceA.evidence);
  assert.deepEqual(validateManifestV2(value), { ok: true, problems: [] });
});

test('the schema-1 manifest remains the active input and is not rewritten', () => {
  assert.equal(manifestV1.schema, 1);
  const onDisk = JSON.parse(fs.readFileSync(path.join(root, 'compatibility/manifest.json'), 'utf8'));
  assert.equal(onDisk.schema, 1);
  assert.equal(onDisk.compatible, false);
});

for (const [label, change, expected] of [
  ['schema 1', (value) => { value.schema = 1; }, 'expected 2'],
  ['compatibility claim', (value) => { value.compatible = true; }, 'compatible must remain false'],
  ['missing profile', (value) => { delete value.profiles['moonbit-native-v1']; }, 'missing profile moonbit-native-v1'],
  ['missing row', (value) => { value.rows = value.rows.filter((row) => row.id !== 'J'); }, 'missing row J'],
  ['duplicate row', (value) => { value.rows.push(structuredClone(value.rows[0])); }, 'duplicate row A'],
  ['unknown implementation', (value) => { value.rows[0].implementation = 'working'; }, 'invalid implementation'],
  ['passed without evidence', (value) => { value.rows[0].verification = 'passed'; value.rows[0].gate = 'satisfied'; }, 'passed without evidence'],
  ['satisfied without passed verification', (value) => { value.rows[0].gate = 'satisfied'; }, 'satisfied without passed verification'],
  ['blocked profile without reason', (value) => { value.profiles['electron-nodeless-v1'].blockedReason = ''; }, 'blocked without a reason'],
]) {
  test(`schema-v2 admission rejects ${label}`, () => {
    const value = migrated();
    change(value);
    const result = validateManifestV2(value);
    assert.equal(result.ok, false);
    assert.ok(result.problems.some((problem) => problem.includes(expected)), result.problems.join(' | '));
  });
}

test('migration rejects a verified schema-1 row that has no evidence', () => {
  const value = structuredClone(manifestV1);
  const row = value.rows.find((item) => item.id === 'A');
  row.status = 'verified';
  row.evidence = [];
  assert.throws(() => migrateManifestV1(value, profiles), /must carry evidence/);
});
