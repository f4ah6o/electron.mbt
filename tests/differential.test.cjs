'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const { snapshot } = require('../bridges/node/app-files.cjs');
const manifest = require('../compatibility/manifest.json');
const root = path.resolve(__dirname, '..');
const script = path.join(root, 'scripts/differential.cjs');
const oracleFixture = path.join(root, 'fixtures/oracle');

function temp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'electron-mbt-differential-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// Reports always go to a per-test output path; evidence/differential.json is
// reserved for an intentional collection run, never for test output.
function run(t, args) {
  const output = path.join(temp(t), 'report.json');
  const result = spawnSync(process.execPath, [script, '--output', output, ...args], { cwd: root, encoding: 'utf8', timeout: 45000 });
  result.output = output;
  return result;
}

function baselineFile(t, observed, { fixtureDir = oracleFixture, overrides = {} } = {}) {
  const file = path.join(temp(t), 'baseline.json');
  const inventory = snapshot(fixtureDir);
  fs.writeFileSync(file, JSON.stringify({
    schema: 1, status: 'baseline-collected', compatible: false,
    fixtureHash: inventory.sha256, fileHashes: inventory.files,
    observed, ...overrides,
  }));
  return file;
}

function fixtureApp(t, mainSource) {
  const dir = temp(t);
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'differential-test-fixture', version: '0.0.0', main: 'main.cjs' }));
  fs.writeFileSync(path.join(dir, 'main.cjs'), mainSource);
  return dir;
}

const completedObservation = {
  status: 'completed', moduleIdentity: true,
  trace: [['isReady-before', false], ['before-ready-throws', true], ['ready', true], ['bounds-synchronous', true], ['did-finish-load'], ['close-cancel'], ['alive-after-cancel', true], ['closed'], ['before-quit'], ['will-quit'], ['quit']],
  observation: { availableAtFirstScript: true, syncValue: 42, syncThrow: true, returnsPromise: true, promiseValue: 43, promiseReject: true, dataFrozen: true, dataUnchanged: true, callbackValues: ['first', 'second'], primordialIntact: true },
  versions: { electron: manifest.versions.electronOracle, node: manifest.versions.nodeOracle, chromium: '152.0.7977.130' },
  platform: 'darwin', arch: 'arm64',
};

test('the unchanged fixture passes listener registration and records its next explicit failure', t => {
  const result = run(t, ['--baseline', baselineFile(t, completedObservation)]);
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.status, 'differential-collected');
  assert.equal(report.compatible, false);
  assert.equal(report.mbt.observed.status, 'failed');
  assert.equal(report.mbt.observed.code, 'ready-rejected');
  assert.equal(report.mbt.observed.exitCode, 1);
  assert.equal(report.mbt.observed.moduleIdentity, true);
  assert.deepEqual(report.mbt.observed.trace, completedObservation.trace.slice(0, 3));
  const comparison = report.comparison;
  assert.equal(comparison.ok, true);
  assert.equal(comparison.verdict, 'diverged');
  assert.equal(comparison.compatible, false);
  assert.equal(comparison.fields.status.match, false);
  assert.equal(comparison.fields.trace.matchedPrefix, 3);
  assert.equal(comparison.fields.trace.firstDivergence.index, 3);
  assert.equal(comparison.fields.trace.firstDivergence.mbt, null);
  assert.equal(Object.hasOwn(report.mbt.observed, 'abort'), false);
  assert.equal(JSON.parse(fs.readFileSync(result.output, 'utf8')).status, 'differential-collected');
});

test('an equivalent completed synthetic pair reports equivalent without claiming compatibility', t => {
  // An aborted Electron reference is not admissible even if the comparator
  // itself can compare arbitrary objects. Keep synthetic reports in temp dirs.
  const dir = fixtureApp(t, `require('node:fs').writeSync(1, ${JSON.stringify(`ELECTRON_MBT_ORACLE=${JSON.stringify(completedObservation)}\n`)});`);
  const result = run(t, ['--fixture', dir, '--baseline', baselineFile(t, completedObservation, { fixtureDir: dir })]);
  assert.equal(result.status, 0, result.stderr);
  const comparison = JSON.parse(result.stdout).comparison;
  assert.equal(comparison.verdict, 'equivalent');
  assert.equal(comparison.compatible, false);
});

test('a baseline collected from a different fixture is rejected', t => {
  const result = run(t, ['--baseline', baselineFile(t, completedObservation, { overrides: { fixtureHash: '0'.repeat(64) } })]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /ELECTRON_MBT_DIFFERENTIAL:.*different fixture sources/);
  assert.equal(fs.existsSync(result.output), false);
});

test('an emitted observation followed by a nonzero child exit is not trusted', t => {
  const dir = fixtureApp(t, `require('node:fs').writeSync(1, 'ELECTRON_MBT_ORACLE={"status":"completed"}\\n'); process.exit(1);`);
  const result = run(t, ['--fixture', dir, '--baseline', baselineFile(t, completedObservation, { fixtureDir: dir })]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /ELECTRON_MBT_DIFFERENTIAL:.*did not exit cleanly/);
  assert.equal(fs.existsSync(result.output), false);
});

test('a Node error code on stderr is not a recognized facade abort', t => {
  const dir = fixtureApp(t, `require('__missing__');`);
  const result = run(t, ['--fixture', dir, '--baseline', baselineFile(t, completedObservation, { fixtureDir: dir })]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /ELECTRON_MBT_DIFFERENTIAL:.*recognized diagnostic/);
  assert.equal(fs.existsSync(result.output), false);
});

test('--electron cannot be combined with a non-oracle fixture', t => {
  const dir = fixtureApp(t, ``);
  const result = run(t, ['--fixture', dir, '--electron', process.execPath]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /ELECTRON_MBT_DIFFERENTIAL:.*do not combine it with --fixture/);
  assert.equal(fs.existsSync(result.output), false);
});

test('an unclassified child failure is a harness error, not an abort observation', t => {
  const dir = fixtureApp(t, `throw new Error('unclassified bootstrap crash');`);
  const result = run(t, ['--fixture', dir, '--baseline', baselineFile(t, completedObservation, { fixtureDir: dir })]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /ELECTRON_MBT_DIFFERENTIAL:.*recognized diagnostic/);
  assert.match(result.stderr, /unclassified bootstrap crash/);
  assert.equal(fs.existsSync(result.output), false);
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

test('the comparison verdict belongs to the compiled MoonBit core', () => {
  const core = require('../dist/core.cjs');
  const verdict = JSON.parse(core.compare_observations('{"status":"completed"}', '{"status":"aborted"}'));
  assert.equal(verdict.ok, true);
  assert.equal(verdict.verdict, 'diverged');
  assert.equal(JSON.parse(core.compare_observations('{"a":', '{}')).ok, false);
});

for (const [label, change, overrides, expectedField] of [
  ['aborted reference', value => { value.status = 'aborted'; }, {}, 'observed.status'],
  ['wrong Electron pin', value => { value.versions.electron = '0.0.0'; }, {}, 'observed.versions.electron'],
  ['wrong Node pin', value => { value.versions.node = '0.0.0'; }, {}, 'observed.versions.node'],
  ['missing trace', value => { delete value.trace; }, {}, 'observed.trace'],
  ['empty trace', value => { value.trace = []; }, {}, 'observed.trace'],
  ['empty measurement payload', value => { value.observation = {}; }, {}, 'observed.observation'],
  ['compatibility claim', () => {}, { compatible: true }, 'compatible'],
]) {
  test(`a saved ${label} is rejected before the fixture can run`, t => {
    const marker = path.join(temp(t), 'launched');
    const dir = fixtureApp(t, `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'launched');`);
    const value = structuredClone(completedObservation);
    change(value);
    const result = run(t, ['--fixture', dir, '--baseline', baselineFile(t, value, { fixtureDir: dir, overrides })]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /baseline rejected/);
    assert.ok(result.stderr.includes(expectedField), result.stderr);
    assert.equal(fs.existsSync(marker), false);
    assert.equal(fs.existsSync(result.output), false);
  });
}

test('oversized and non-file baselines are rejected without publishing a report', t => {
  const directory = temp(t);
  const oversized = path.join(directory, 'oversized.json');
  fs.writeFileSync(oversized, ' '.repeat(65537));
  const large = run(t, ['--baseline', oversized]);
  assert.equal(large.status, 1);
  assert.match(large.stderr, /65536-byte file limit/);
  assert.equal(fs.existsSync(large.output), false);
  const nonFile = run(t, ['--baseline', directory]);
  assert.equal(nonFile.status, 1);
  assert.match(nonFile.stderr, /not a regular file/);
  assert.equal(fs.existsSync(nonFile.output), false);
});
