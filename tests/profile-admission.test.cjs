'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const core = require('../dist/core.cjs');
const root = path.resolve(__dirname, '..');
const configPath = path.join(root, 'compatibility/runtime-profiles-v1.json');
const configRaw = fs.readFileSync(configPath, 'utf8');

function validate(profile, inputMode = '', preloadMode = '', runtime = '') {
  return JSON.parse(core.validate_profile(configRaw, profile, inputMode, preloadMode, runtime));
}

function run(args) {
  return spawnSync(process.execPath, ['cmd/legacy-node.cjs', ...args], { cwd: root, encoding: 'utf8' });
}

test('the compiled boundary admits a known open profile without claiming compatibility', () => {
  const result = validate('desktop-core-v1');
  assert.equal(result.ok, true);
  assert.equal(result.profile, 'desktop-core-v1');
  assert.equal(result.gate, 'open');
  assert.equal(result.compatible, false);
  assert.equal(result.verification, 'not-run');
});

test('the strict profile is recognized but remains blocked', () => {
  const result = validate('electron-nodeless-v1');
  assert.equal(result.ok, true);
  assert.equal(result.gate, 'blocked');
  assert.equal(result.compatible, false);
  assert.ok(result.diagnostics.includes('ELECTRON_MBT_PROFILE_BLOCKED'));
});

test('unknown profiles and mismatched selections are rejected', () => {
  const unknown = validate('unknown-profile');
  assert.equal(unknown.ok, false);
  assert.equal(unknown.code, 'ELECTRON_MBT_UNKNOWN_PROFILE');
  const input = validate('desktop-core-v1', 'esm-main');
  assert.equal(input.code, 'ELECTRON_MBT_PROFILE_MISMATCH');
  assert.equal(input.field, 'inputMode');
  const preload = validate('electron-nodeless-adapted-v1', 'original-cjs', 'original');
  assert.equal(preload.code, 'ELECTRON_MBT_PROFILE_MISMATCH');
  assert.equal(preload.field, 'preloadMode');
  const runtime = validate('electron-nodeless-adapted-v1', '', '', 'node-backed');
  assert.equal(runtime.code, 'ELECTRON_MBT_PROFILE_MISMATCH');
  assert.equal(runtime.field, 'runtime');
});

test('doctor accepts a known profile and keeps the M0 non-success exit', () => {
  const result = run(['doctor', 'fixtures/cjs', '--profile', 'desktop-core-v1', '--input-mode', 'original-cjs', '--preload-mode', 'original', '--runtime', 'node-backed']);
  assert.equal(result.status, 2, result.stderr || result.stdout);
  const report = JSON.parse(result.stdout);
  assert.equal(report.requestedProfile, 'desktop-core-v1');
  assert.equal(report.profileAdmission.ok, true);
  assert.equal(report.profileAdmission.compatible, false);
  assert.equal(report.compatible, false);
  assert.ok(report.diagnostics.includes('ELECTRON_MBT_M0_INCOMPLETE'));
});

test('unknown or mismatched profiles are rejected before app evaluation', () => {
  const missingApp = path.join(root, 'no-such-app-for-profile-admission');
  const unknown = run(['doctor', missingApp, '--profile', 'unknown-profile']);
  assert.equal(unknown.status, 2, unknown.stderr || unknown.stdout);
  assert.equal(JSON.parse(unknown.stdout).code, 'ELECTRON_MBT_UNKNOWN_PROFILE');
  assert.doesNotMatch(unknown.stderr, /ENOENT/);
  const mismatch = run(['compat-check', missingApp, '--profile', 'electron-nodeless-adapted-v1', '--preload-mode', 'original']);
  assert.equal(mismatch.status, 2, mismatch.stderr || mismatch.stdout);
  assert.equal(JSON.parse(mismatch.stdout).code, 'ELECTRON_MBT_PROFILE_MISMATCH');
});

test('profile options are rejected on commands that do not consume them', () => {
  const result = run(['snapshot', 'fixtures/cjs', '--profile', 'desktop-core-v1']);
  assert.equal(result.status, 1);
  assert.equal(JSON.parse(result.stdout).code, 'ELECTRON_MBT_USAGE');
});
