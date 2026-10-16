'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseCandidateObservation } = require('../scripts/candidate-observation.cjs');
const failed = {
  status: 'failed', code: 'ready-rejected', moduleIdentity: true,
  trace: [['isReady-before', false], ['before-ready-throws', true], ['ready', true]],
  versions: { node: '24.21.0' }, platform: 'darwin', arch: 'arm64',
};

test('a declared fixture failure retains failed status partial trace and nonzero exit code', () => {
  assert.deepEqual(parseCandidateObservation({ status: 1 }, JSON.stringify(failed)), { ...failed, exitCode: 1 });
});

test('a completed observation followed by exit one remains a harness failure', () => {
  assert.throws(() => parseCandidateObservation({ status: 1 }, JSON.stringify({ ...failed, status: 'completed' })), /did not exit cleanly/);
});

for (const [label, result] of [
  ['exit two', { status: 2 }],
  ['no exit status', { status: null }],
  ['signal', { status: 1, signal: 'SIGKILL' }],
  ['timeout', { status: 1, error: { code: 'ETIMEDOUT' } }],
  ['spawn failure', { status: 1, error: { code: 'ENOENT' } }],
]) {
  test(`a failure marker cannot hide ${label}`, () => {
    assert.throws(() => parseCandidateObservation(result, JSON.stringify(failed)), /did not exit cleanly/);
  });
}

for (const [label, change] of [
  ['unrecognized failure code', value => { value.code = 'unknown'; }],
  ['missing failure code', value => { delete value.code; }],
  ['mistyped identity', value => { value.moduleIdentity = 'true'; }],
  ['missing identity', value => { delete value.moduleIdentity; }],
  ['null trace', value => { value.trace = null; }],
  ['missing node version', value => { value.versions = {}; }],
  ['missing platform', value => { delete value.platform; }],
  ['empty architecture', value => { value.arch = ''; }],
]) {
  test(`${label} cannot be admitted as a declared fixture failure`, () => {
    const value = structuredClone(failed);
    change(value);
    assert.throws(() => parseCandidateObservation({ status: 1 }, JSON.stringify(value)), /did not exit cleanly/);
  });
}

test('malformed and oversized output is rejected even after a zero exit', () => {
  for (const raw of ['{', ' '.repeat(16385)]) {
    assert.throws(() => parseCandidateObservation({ status: 0 }, raw), /malformed or oversized/);
    assert.throws(() => parseCandidateObservation({ status: 1 }, raw), /did not exit cleanly/);
  }
});

test('clean completed observations keep the existing transport contract', () => {
  const value = { status: 'completed', trace: [] };
  assert.deepEqual(parseCandidateObservation({ status: 0 }, JSON.stringify(value)), value);
});
