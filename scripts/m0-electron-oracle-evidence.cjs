'use strict';
const assert = require('node:assert/strict');

function validateErrorEvidence(record) {
  assert.ok(record && typeof record === 'object' && !Array.isArray(record));
  assert.equal(record.name, 'Error');
  assert.equal(record.typeofValue, 'object');
  assert.ok(['[object Error]', '[object Object]'].includes(record.objectTag));
  // Why not: a page-realm instanceof result is an observation, not a
  // cross-world guarantee; do not make a guessed value a compatibility gate.
  assert.equal(typeof record.pageRealmInstance, 'boolean');
}

function validateM0ElectronOracleObservation(observed) {
  assert.ok(observed && typeof observed === 'object' && !Array.isArray(observed));
  assert.equal(observed.availableAtFirstScript, true);
  assert.equal(observed.syncValue, 42);
  assert.equal(observed.syncThrow, true);
  validateErrorEvidence(observed.syncThrowError);
  assert.equal(observed.returnsPromise, true);
  assert.equal(observed.promiseValue, 43);
  assert.equal(observed.promiseReject, true);
  validateErrorEvidence(observed.promiseRejectError);
  assert.equal(observed.dataFrozen, true);
  assert.equal(observed.dataUnchanged, true);
  // Why not: Electron 44.7.0 does not guarantee a stable proxy for the same
  // callback argument across separate bridge calls; this is pinned observation.
  assert.deepEqual(observed.callbackValues, ['first', 'second']);
  assert.equal(observed.callbackRemovalByOriginalIdentity, false);
  assert.equal(observed.disposerIsFunction, true);
  assert.equal(observed.disposeOnce, true);
  assert.equal(observed.disposeTwice, false);
  assert.deepEqual(observed.subscriptionValues, ['sub-first']);
  assert.equal(observed.primordialIntact, true);
  return observed;
}

module.exports = { validateM0ElectronOracleObservation };
