'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { validateM0ElectronOracleObservation } = require('../scripts/m0-electron-oracle-evidence.cjs');

function sample() {
  return {
    availableAtFirstScript: true,
    syncValue: 42,
    syncThrow: true,
    syncThrowError: { name: 'Error', typeofValue: 'object', objectTag: '[object Error]', pageRealmInstance: true },
    returnsPromise: true,
    promiseValue: 43,
    promiseReject: true,
    promiseRejectError: { name: 'Error', typeofValue: 'object', objectTag: '[object Error]', pageRealmInstance: true },
    dataFrozen: true,
    dataUnchanged: true,
    callbackValues: ['first', 'second'],
    callbackRemovalByOriginalIdentity: false,
    disposerIsFunction: true,
    disposeOnce: true,
    disposeTwice: false,
    subscriptionValues: ['sub-first'],
    primordialIntact: true,
  };
}

test('What: pinned sandboxed Electron M0 fixture requires sync, Promise, copy, callback and disposer evidence', () => {
  const observed = sample();
  assert.equal(validateM0ElectronOracleObservation(observed), observed);
});

test('What: a missing, contradictory or inflated bridge observation is rejected', () => {
  const cases = [
    o => { o.availableAtFirstScript = false; },
    o => { o.syncValue = Promise.resolve(42); },
    o => { o.syncThrow = false; },
    o => { delete o.syncThrowError; },
    o => { o.syncThrowError.name = 'TypeError'; },
    o => { o.syncThrowError.typeofValue = 'string'; },
    o => { o.syncThrowError.objectTag = '[object String]'; },
    o => { o.syncThrowError.pageRealmInstance = 'true'; },
    o => { o.syncThrowError.pageRealmInstance = false; },
    o => { o.syncThrowError.objectTag = '[object Object]'; },
    o => { o.returnsPromise = false; },
    o => { o.promiseValue = 0; },
    o => { o.promiseReject = false; },
    o => { delete o.promiseRejectError; },
    o => { o.promiseRejectError.name = undefined; },
    o => { o.promiseRejectError.typeofValue = undefined; },
    o => { o.promiseRejectError.pageRealmInstance = null; },
    o => { o.promiseRejectError.pageRealmInstance = false; },
    o => { o.promiseRejectError.objectTag = '[object Object]'; },
    o => { o.dataFrozen = false; },
    o => { o.dataUnchanged = false; },
    o => { o.callbackValues = ['first']; },
    o => { o.callbackRemovalByOriginalIdentity = true; },
    o => { o.disposerIsFunction = false; },
    o => { o.disposeOnce = false; },
    o => { o.disposeTwice = true; },
    o => { o.subscriptionValues = ['sub-first', 'sub-second']; },
    o => { o.primordialIntact = false; },
    o => { delete o.disposerIsFunction; },
  ];
  for (const change of cases) {
    const observed = sample();
    change(observed);
    assert.throws(() => validateM0ElectronOracleObservation(observed));
  }
});

test('What: the pinned Electron oracle preserves page-realm Error instances for sync throw and Promise rejection', () => {
  const observed = validateM0ElectronOracleObservation(sample());
  assert.equal(observed.syncThrowError.name, 'Error');
  assert.equal(observed.promiseRejectError.name, 'Error');
  assert.equal(observed.syncThrowError.pageRealmInstance, true);
  assert.equal(observed.promiseRejectError.pageRealmInstance, true);
});

test('What: Electron callback identity observation is not reported as a stable-proxy guarantee', () => {
  const observed = validateM0ElectronOracleObservation(sample());
  assert.deepEqual(observed.callbackValues, ['first', 'second']);
  assert.equal(observed.callbackRemovalByOriginalIdentity, false);
  assert.deepEqual(observed.subscriptionValues, ['sub-first']);
});
