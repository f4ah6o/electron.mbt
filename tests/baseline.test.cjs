'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../dist/core.cjs');
const manifest = require('../compatibility/manifest.json');
const hash = 'a'.repeat(64);

function report() {
  return {
    schema: 1, status: 'baseline-collected', compatible: false, fixtureHash: hash,
    observed: {
      status: 'completed', moduleIdentity: true, trace: [['ready', true], ['quit']],
      observation: { syncValue: 42, syncThrow: false },
      versions: { electron: manifest.versions.electronOracle, node: manifest.versions.nodeOracle },
      platform: 'darwin', arch: 'arm64',
    },
  };
}

function validate(value, pins = {}) {
  return JSON.parse(core.validate_baseline(
    JSON.stringify(value),
    pins.electron ?? manifest.versions.electronOracle,
    pins.node ?? manifest.versions.nodeOracle,
    pins.hash ?? hash,
  ));
}

function edit(value, keys, replacement, remove = false) {
  let target = value;
  for (const key of keys.slice(0, -1)) target = target[key];
  if (remove) delete target[keys.at(-1)];
  else target[keys.at(-1)] = replacement;
}

test('the compiled core admits a completed pinned baseline without claiming compatibility', () => {
  assert.deepEqual(validate(report()), { ok: true, compatible: false });
});

for (const [label, keys, replacement, expectedField] of [
  ['wrong schema', ['schema'], 2, 'schema'],
  ['fractional schema', ['schema'], 1.1, 'schema'],
  ['wrong report status', ['status'], 'differential-collected', 'status'],
  ['a compatibility claim', ['compatible'], true, 'compatible'],
  ['different fixture sources', ['fixtureHash'], 'b'.repeat(64), 'fixtureHash'],
  ['a null observation envelope', ['observed'], null, 'observed'],
  ['an array observation envelope', ['observed'], [], 'observed'],
  ['an aborted reference', ['observed', 'status'], 'aborted', 'observed.status'],
  ['a failed reference', ['observed', 'status'], 'failed', 'observed.status'],
  ['an incomplete reference', ['observed', 'status'], 'running', 'observed.status'],
  ['an abort on a completed reference', ['observed', 'abort'], {}, 'observed.abort'],
  ['a null abort on a completed reference', ['observed', 'abort'], null, 'observed.abort'],
  ['a different Electron version', ['observed', 'versions', 'electron'], '0.0.0', 'observed.versions.electron'],
  ['a different Node version', ['observed', 'versions', 'node'], '0.0.0', 'observed.versions.node'],
  ['an empty platform', ['observed', 'platform'], '', 'observed.platform'],
  ['a numeric architecture', ['observed', 'arch'], 64, 'observed.arch'],
  ['an unknown module identity', ['observed', 'moduleIdentity'], null, 'observed.moduleIdentity'],
  ['a non-array trace', ['observed', 'trace'], {}, 'observed.trace'],
  ['missing measurements', ['observed', 'observation'], null, 'observed.observation'],
  ['array measurements', ['observed', 'observation'], [], 'observed.observation'],
]) {
  test(`baseline admission rejects ${label}`, () => {
    const value = report();
    edit(value, keys, replacement);
    assert.deepEqual(validate(value), { ok: false, compatible: false, code: 'ELECTRON_MBT_INVALID_BASELINE', field: expectedField });
  });
}

for (const keys of [
  ['schema'], ['status'], ['compatible'], ['fixtureHash'], ['observed'],
  ['observed', 'status'], ['observed', 'versions'], ['observed', 'versions', 'electron'],
  ['observed', 'versions', 'node'], ['observed', 'platform'], ['observed', 'arch'],
  ['observed', 'moduleIdentity'], ['observed', 'trace'], ['observed', 'observation'],
]) {
  test(`baseline admission rejects absent and null ${keys.join('.')}`, () => {
    for (const remove of [true, false]) {
      const value = report();
      edit(value, keys, null, remove);
      assert.equal(validate(value).ok, false);
    }
  });
}

test('negative measurements and another recorded platform are not forced to match', () => {
  const value = report();
  value.observed.moduleIdentity = false;
  value.observed.platform = 'linux';
  value.observed.arch = 'x64';
  value.observed.observation = { syncThrow: false, promiseReject: false };
  assert.equal(validate(value).ok, true);
});

test('malformed and oversized raw baseline payloads are rejected at the compiled boundary', () => {
  for (const raw of ['{', JSON.stringify(report()) + ' '.repeat(16385)]) {
    const result = JSON.parse(core.validate_baseline(raw, manifest.versions.electronOracle, manifest.versions.nodeOracle, hash));
    assert.equal(result.ok, false);
    assert.equal(result.code, 'InvalidPayload');
  }
  for (const value of [null, [], true, 1, 'baseline']) assert.equal(validate(value).ok, false);
});

test('empty or mismatched pins cannot admit a baseline', () => {
  for (const pins of [{ electron: '' }, { node: '' }, { hash: '' }, { hash: 'a'.repeat(63) }, { electron: '0.0.0' }, { node: '0.0.0' }]) {
    assert.equal(validate(report(), pins).ok, false);
  }
});

test('arbitrary observation comparison remains separate from reference admission', () => {
  const aborted = JSON.stringify({ status: 'aborted', trace: [], abort: { code: 'ELECTRON_MBT_UNSUPPORTED_API' } });
  const comparison = JSON.parse(core.compare_observations(aborted, aborted));
  assert.equal(comparison.verdict, 'equivalent');
  assert.equal(comparison.compatible, false);
  const baseline = report();
  baseline.observed = JSON.parse(aborted);
  assert.equal(validate(baseline).ok, false);
});
