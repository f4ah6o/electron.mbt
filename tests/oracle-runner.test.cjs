'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { snapshot } = require('../bridges/node/app-files.cjs');
const manifest = require('../compatibility/manifest.json');
const root = path.resolve(__dirname, '..');
const script = path.join(root, 'scripts/oracle.cjs');

function observed() {
  return {
    status: 'completed', moduleIdentity: true, trace: [['quit']], observation: { syncValue: 42 },
    versions: { electron: manifest.versions.electronOracle, node: manifest.versions.nodeOracle },
    platform: 'darwin', arch: 'arm64',
  };
}

function run(t, source) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'electron-mbt-oracle-runner-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const executable = path.join(directory, 'synthetic-oracle.cjs');
  // A synthetic child tests admission failures, not Electron compatibility.
  // Its report must never enter the default evidence directory.
  fs.writeFileSync(executable, `#!${process.execPath}\n${source}\n`, { mode: 0o700 });
  const output = path.join(directory, 'nested', 'synthetic-baseline.json');
  const before = snapshot(path.join(root, 'fixtures/oracle')).sha256;
  const result = spawnSync(process.execPath, [script, executable, '--output', output], { cwd: root, encoding: 'utf8', timeout: 35000 });
  assert.equal(snapshot(path.join(root, 'fixtures/oracle')).sha256, before);
  return { ...result, output };
}

function emit(value, suffix = '') {
  return `require('node:fs').writeSync(1, ${JSON.stringify(`ELECTRON_MBT_ORACLE=${JSON.stringify(value)}\n`)}); ${suffix}`;
}

test('synthetic valid data exercises admission and writes only the requested test output', t => {
  const result = run(t, emit(observed()));
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.status, 'baseline-collected');
  assert.equal(report.compatible, false);
  assert.deepEqual(JSON.parse(fs.readFileSync(result.output, 'utf8')), report);
});

for (const [label, change, expected] of [
  ['an aborted observation', value => { value.status = 'aborted'; }, /observed.status/],
  ['a version mismatch', value => { value.versions.electron = '0.0.0'; }, /observed.versions.electron/],
  ['missing measurements', value => { delete value.observation; }, /observed.observation/],
  ['a null observation', () => null, /observed/],
]) {
  test(`oracle runner does not publish ${label} despite exit zero`, t => {
    const value = observed();
    const changed = change(value);
    const result = run(t, emit(changed === null ? null : value));
    assert.equal(result.status, 1);
    assert.match(result.stderr, expected);
    assert.equal(fs.existsSync(result.output), false);
  });
}

test('oracle runner rejects a valid marker followed by a nonzero child exit', t => {
  const result = run(t, emit(observed(), 'process.exit(7);'));
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Oracle execution failed/);
  assert.equal(fs.existsSync(result.output), false);
});

test('oracle runner rejects a valid marker followed by signal termination', t => {
  const result = run(t, emit(observed(), "process.kill(process.pid, 'SIGKILL');"));
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Oracle execution failed.*SIGKILL/);
  assert.equal(fs.existsSync(result.output), false);
});

test('oracle runner rejects missing duplicate and malformed result markers', t => {
  for (const source of ['', emit(observed()) + emit(observed()), "console.log('ELECTRON_MBT_ORACLE={');"]) {
    const result = run(t, source);
    assert.equal(result.status, 1);
    assert.equal(fs.existsSync(result.output), false);
  }
});
