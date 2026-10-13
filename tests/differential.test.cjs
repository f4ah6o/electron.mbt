'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const { snapshot } = require('../bridges/node/app-files.cjs');
const root = path.resolve(__dirname, '..');
const script = path.join(root, 'scripts/differential.cjs');

function temp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'electron-mbt-differential-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function baselineFile(t, observed, extra = {}) {
  const file = path.join(temp(t), 'baseline.json');
  fs.writeFileSync(file, JSON.stringify({
    schema: 1, status: 'baseline-collected', compatible: false,
    fixtureHash: snapshot(path.join(root, 'fixtures/oracle')).sha256,
    observed, ...extra,
  }));
  return file;
}

function run(t, args) {
  const result = spawnSync(process.execPath, [script, ...args], { cwd: root, encoding: 'utf8', timeout: 45000 });
  return result;
}

const completedObservation = {
  status: 'completed', moduleIdentity: true,
  trace: [['isReady-before', false], ['before-ready-throws', true], ['ready', true], ['bounds-synchronous', true], ['did-finish-load'], ['close-cancel'], ['alive-after-cancel', true], ['closed'], ['before-quit'], ['will-quit'], ['quit']],
  observation: { availableAtFirstScript: true, syncValue: 42, syncThrow: true, returnsPromise: true, promiseValue: 43, promiseReject: true, dataFrozen: true, dataUnchanged: true, callbackValues: ['first', 'second'], primordialIntact: true },
  versions: { electron: '44.7.0', node: '24.21.0', chromium: '152.0.7977.130' },
  platform: 'darwin', arch: 'arm64',
};

test('a completed Electron baseline diverges where the facade fails closed', t => {
  const result = run(t, ['--baseline', baselineFile(t, completedObservation)]);
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.status, 'differential-collected');
  assert.equal(report.compatible, false);
  assert.equal(report.fixtureHashMatch, true);
  assert.equal(report.mbt.observed.status, 'aborted');
  assert.equal(report.mbt.observed.abort.code, 'ELECTRON_MBT_UNSUPPORTED_API');
  const comparison = report.comparison;
  assert.equal(comparison.ok, true);
  assert.equal(comparison.verdict, 'diverged');
  assert.equal(comparison.compatible, false);
  assert.equal(comparison.fields.status.match, false);
  assert.equal(comparison.fields.trace.matchedPrefix, 0);
  assert.equal(comparison.fields.trace.firstDivergence.index, 0);
  assert.equal(comparison.fields.trace.firstDivergence.mbt, null);
  assert.equal(comparison.fields.abort.match, false);
  assert.equal(comparison.fields.abort.mbt.api, 'ipcMain.on');
});

test('an equivalent pair reports equivalent without claiming compatibility', t => {
  // The harness synthesizes an aborted observation when the run cannot emit;
  // environment fields are recorded but never compared.
  const aborted = {
    status: 'aborted', moduleIdentity: null, trace: [], observation: null,
    versions: { node: '0.0.0-fake' }, platform: 'darwin', arch: 'arm64',
    abort: { phase: 'evaluate-or-run', code: 'ELECTRON_MBT_UNSUPPORTED_API', api: 'ipcMain.on' },
  };
  const result = run(t, ['--baseline', baselineFile(t, aborted)]);
  assert.equal(result.status, 0, result.stderr);
  const comparison = JSON.parse(result.stdout).comparison;
  assert.equal(comparison.verdict, 'equivalent');
  assert.equal(comparison.compatible, false);
});

test('a baseline collected from a different fixture is flagged', t => {
  const result = run(t, ['--baseline', baselineFile(t, completedObservation, { fixtureHash: '0'.repeat(64) })]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).fixtureHashMatch, false);
});

test('unusable baselines and arguments are rejected before any run', t => {
  const missing = run(t, ['--baseline', path.join(root, 'no-such-baseline.json')]);
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /^ELECTRON_MBT_DIFFERENTIAL:/);
  const malformed = path.join(temp(t), 'malformed.json');
  fs.writeFileSync(malformed, '{"schema":1}');
  const bad = run(t, ['--baseline', malformed]);
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /^ELECTRON_MBT_DIFFERENTIAL:/);
  const usage = run(t, ['--nonsense']);
  assert.equal(usage.status, 1);
  assert.match(usage.stderr, /^ELECTRON_MBT_DIFFERENTIAL:/);
});

test('the comparison verdict belongs to the compiled MoonBit core', t => {
  const core = require('../dist/core.cjs');
  const verdict = JSON.parse(core.compare_observations('{"status":"completed"}', '{"status":"aborted"}'));
  assert.equal(verdict.ok, true);
  assert.equal(verdict.verdict, 'diverged');
  assert.equal(JSON.parse(core.compare_observations('{"a":', '{}')).ok, false);
});
