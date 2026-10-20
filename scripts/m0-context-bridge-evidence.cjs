'use strict';
const assert = require('node:assert/strict');
const { validateM0ElectronOracleObservation } = require('./m0-electron-oracle-evidence.cjs');

const HEX64 = /^[0-9a-f]{64}$/;
const DECISIONS = new Set(['go', 'no-go', 'blocked']);

function isHex64(value) {
  return typeof value === 'string' && HEX64.test(value);
}

function validErrorEvidence(value) {
  return value && typeof value === 'object' && !Array.isArray(value) &&
    value.name === 'Error' && value.typeofValue === 'object' &&
    value.objectTag === '[object Error]' && value.pageRealmInstance === true;
}

function checkpointOneFromObservation(observed, secretVisible) {
  const forgery = observed && observed.forgery && typeof observed.forgery === 'object'
    ? observed.forgery : {};
  const accepted = observed?.preSeededForgedAccepted === true ||
    observed?.listenerForgedAccepted === true ||
    observed?.captureBlockedForgedAccepted === true ||
    observed?.afterListenerForgedAccepted === true;
  const firstScript = observed?.firstScriptAttempted === true && observed?.apiAvailable === true;
  const syncValue = observed?.syncValue === 42 && observed?.syncValueType === 'number';
  const syncThrow = observed?.syncThrow === true && validErrorEvidence(observed?.syncThrowError);
  const internalsHidden = observed?.bridgeInternalsHidden === true &&
    observed?.nativeHandlersHidden === true;
  return {
    firstScript,
    syncValue,
    syncThrow,
    syncValueThenable: observed?.syncValueType !== 'number',
    forgery: {
      preSeededForgedAccepted: observed?.preSeededForgedAccepted === true,
      listenerForgedAccepted: observed?.listenerForgedAccepted === true,
      captureBlockedForgedAccepted: observed?.captureBlockedForgedAccepted === true,
      afterListenerForgedAccepted: observed?.afterListenerForgedAccepted === true,
    },
    secretVisible: secretVisible === true,
    result: firstScript && syncValue && syncThrow && !accepted && internalsHidden &&
      secretVisible !== true,
  };
}

function validateCheckpointOne(report) {
  const checkpoint = report.checkpoint1;
  assert.ok(checkpoint && typeof checkpoint === 'object' && !Array.isArray(checkpoint),
    'checkpoint1 missing');
  for (const key of ['firstScript', 'syncValue', 'syncThrow', 'syncValueThenable', 'secretVisible', 'result']) {
    assert.equal(typeof checkpoint[key], 'boolean', `checkpoint1.${key}`);
  }
  assert.ok(checkpoint.forgery && typeof checkpoint.forgery === 'object');
  for (const key of ['preSeededForgedAccepted', 'listenerForgedAccepted',
    'captureBlockedForgedAccepted', 'afterListenerForgedAccepted']) {
    assert.equal(typeof checkpoint.forgery[key], 'boolean', `checkpoint1.forgery.${key}`);
  }
  const observed = report.observations?.checkpoint1;
  assert.ok(observed && typeof observed === 'object' && !Array.isArray(observed),
    'checkpoint1 observation missing');
  for (const key of ['firstScriptAttempted', 'apiAvailable', 'syncThrow',
    'bridgeInternalsHidden', 'nativeHandlersHidden', 'preSeededForgedAccepted',
    'listenerForgedAccepted', 'captureBlockedForgedAccepted', 'afterListenerForgedAccepted']) {
    assert.equal(typeof observed[key], 'boolean', `checkpoint1.${key}`);
  }
  // A failed checkpoint may expose a non-number or absent syncValue; the
  // derived boolean below is what the candidate claim must match.
  assert.equal(typeof observed.syncValueType, 'string', 'checkpoint1.syncValueType');
  assert.ok(observed.syncThrowError === null || typeof observed.syncThrowError === 'object');
  const derived = checkpointOneFromObservation(observed, report.native?.secretLeakDetected);
  assert.equal(checkpoint.firstScript, derived.firstScript, 'checkpoint1.firstScript derived');
  assert.equal(checkpoint.syncValue, derived.syncValue, 'checkpoint1.syncValue derived');
  assert.equal(checkpoint.syncThrow, derived.syncThrow, 'checkpoint1.syncThrow derived');
  assert.equal(checkpoint.syncValueThenable, derived.syncValueThenable,
    'checkpoint1.syncValueThenable derived');
  assert.deepEqual(checkpoint.forgery, derived.forgery, 'checkpoint1.forgery derived');
  assert.equal(checkpoint.secretVisible, derived.secretVisible, 'checkpoint1.secretVisible derived');
  assert.equal(checkpoint.result, derived.result, 'checkpoint1.result derived');
  return checkpoint;
}

function validateNegativeObservation(observed) {
  assert.ok(observed && typeof observed === 'object' && !Array.isArray(observed),
    'negative observation missing');
  for (const key of ['complete', 'nestedReentrant', 'callbackThrowReconstructed',
    'bridgeUnaffected', 'unsupportedRejected', 'oversizeRejected', 'cyclicRejected',
    'childAccessDenied', 'childMessageObserved', 'childOpaqueOrigin', 'childNotRelayed',
    'handlerHidden', 'internalsHidden']) {
    assert.equal(observed[key], true, `negative.${key}`);
  }
  assert.equal(observed.secretVisible, false, 'negative.secretVisible');
}

// The frame/origin section is additive to the B5 checkpoints. A complete
// observation is required for a go; a denied same-origin access is a valid
// finding (main-frame-only under the tested WebKit), not a forced pass.
function validateFramePolicy(report) {
  const policy = report.framePolicy;
  assert.ok(policy && typeof policy === 'object' && !Array.isArray(policy),
    'framePolicy missing');
  assert.equal(policy.version, 1, 'framePolicy.version');
  assert.equal(policy.observationComplete, true, 'framePolicy.observationComplete');
  assert.equal(typeof policy.hypothesis, 'string', 'framePolicy.hypothesis');
  assert.ok(policy.hypothesis.length > 0, 'framePolicy.hypothesis');
  assert.equal(typeof policy.hypothesisSupported, 'boolean', 'framePolicy.hypothesisSupported');

  const same = policy.sameOriginChild;
  const sandbox = policy.sandboxedChild;
  assert.ok(same && typeof same === 'object' && !Array.isArray(same),
    'framePolicy.sameOriginChild missing');
  assert.ok(sandbox && typeof sandbox === 'object' && !Array.isArray(sandbox),
    'framePolicy.sandboxedChild missing');
  for (const key of ['messageObserved', 'access', 'originMatches', 'notRelayed',
    'syncThrow', 'handlerHidden']) {
    assert.equal(typeof same[key], 'boolean', `framePolicy.sameOriginChild.${key}`);
  }
  for (const key of ['ownApiType', 'parentApiType', 'syncValueType']) {
    assert.equal(typeof same[key], 'string', `framePolicy.sameOriginChild.${key}`);
  }
  assert.ok(same.accessError === null || typeof same.accessError === 'string',
    'framePolicy.sameOriginChild.accessError');
  assert.ok(same.syncValue === null || typeof same.syncValue === 'number',
    'framePolicy.sameOriginChild.syncValue');
  assert.ok(same.syncValueError === null || typeof same.syncValueError === 'string',
    'framePolicy.sameOriginChild.syncValueError');
  assert.ok(same.throwName === null || typeof same.throwName === 'string',
    'framePolicy.sameOriginChild.throwName');
  assert.ok(same.throwMessage === null || typeof same.throwMessage === 'string',
    'framePolicy.sameOriginChild.throwMessage');
  assert.ok(same.childRealmError === null || typeof same.childRealmError === 'boolean',
    'framePolicy.sameOriginChild.childRealmError');
  assert.ok(same.parentRealmError === null || typeof same.parentRealmError === 'boolean',
    'framePolicy.sameOriginChild.parentRealmError');
  assert.equal(same.messageObserved, true, 'same-origin child must report');
  assert.equal(same.originMatches, true, 'same-origin child origin must match');
  assert.equal(same.notRelayed, true, 'same-origin child message source must match');
  assert.equal(same.ownApiType, 'undefined', 'same-origin child must not have its own shim');
  assert.equal(same.parentApiType, 'object', 'same-origin child must see the parent API');
  assert.equal(same.handlerHidden, true, 'same-origin child must not see native handlers');
  if (same.access) {
    assert.equal(same.syncValue, 42, 'same-origin syncValue');
    assert.equal(same.syncValueType, 'number', 'same-origin syncValueType');
    assert.equal(same.syncValueError, null, 'same-origin syncValueError');
    assert.equal(same.syncThrow, true, 'same-origin syncThrow');
    assert.equal(same.throwName, 'Error', 'same-origin throwName');
    assert.equal(typeof same.throwMessage, 'string', 'same-origin throwMessage');
    assert.ok(same.throwMessage.length > 0, 'same-origin throwMessage');
  } else {
    assert.equal(same.syncValue, null, 'denied same-origin access has no value');
    assert.equal(same.syncThrow, false, 'denied same-origin access has no throw');
    assert.equal(typeof same.accessError, 'string', 'denied same-origin access needs an error');
    assert.ok(same.accessError.length > 0, 'denied same-origin access needs an error');
  }

  for (const key of ['messageObserved', 'opaqueOrigin', 'accessDenied',
    'handlerHidden', 'notRelayed']) {
    assert.equal(typeof sandbox[key], 'boolean', `framePolicy.sandboxedChild.${key}`);
    assert.equal(sandbox[key], true, `framePolicy.sandboxedChild.${key}`);
  }
  assert.ok(Number.isSafeInteger(policy.nativeChildReportsRejected) &&
    policy.nativeChildReportsRejected >= 0, 'framePolicy.nativeChildReportsRejected');
  const derived = same.access === true && sandbox.accessDenied === true;
  assert.equal(policy.hypothesisSupported, derived,
    'framePolicy.hypothesisSupported derived');
  return policy;
}

function validateCheckpointTwo(report, checkpointOne) {
  const checkpoint = report.checkpoint2;
  if (checkpoint === 'NOT_RUN') {
    assert.ok(checkpointOne.result === false || report.decision === 'blocked',
      'checkpoint2 NOT_RUN requires failed checkpoint 1 or blocked decision');
    return checkpoint;
  }
  assert.ok(checkpoint && typeof checkpoint === 'object' && !Array.isArray(checkpoint),
    'checkpoint2 missing');
  for (const key of ['oracleFirst', 'oracleReload', 'negative',
    'navigationRevocation', 'result']) {
    assert.equal(typeof checkpoint[key], 'boolean', `checkpoint2.${key}`);
  }
  const oracleFirst = report.observations?.oracleFirst;
  const oracleReload = report.observations?.oracleReload;
  const negative = report.observations?.negative;
  if (checkpoint.oracleFirst) {
    validateM0ElectronOracleObservation(oracleFirst);
  }
  if (checkpoint.oracleReload) {
    validateM0ElectronOracleObservation(oracleReload);
  }
  if (checkpoint.negative) {
    validateNegativeObservation(negative);
  }
  if (checkpoint.navigationRevocation) {
    assert.equal(report.native?.grantRotated, true, 'grant rotation required');
    assert.ok(report.native?.staleGrantRejected >= 1, 'stale grant rejection required');
    assert.equal(checkpoint.oracleReload, true, 'navigation requires reload observation');
  }
  assert.equal(checkpoint.result,
    checkpoint.oracleFirst && checkpoint.oracleReload && checkpoint.negative &&
    checkpoint.navigationRevocation, 'checkpoint2.result derived');
  return checkpoint;
}

function validateNoRawSecretKeys(value, path) {
  if (value === null || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      validateNoRawSecretKeys(value[index], `${path}[${index}]`);
    }
    return;
  }
  for (const key of Object.keys(value)) {
    assert.ok(!['secret', 'grant', 'nonce'].includes(key),
      `raw secret-like key ${path}.${key} must not appear in evidence`);
    validateNoRawSecretKeys(value[key], `${path}.${key}`);
  }
}

function validateM0ContextBridgeEvidence(report) {
  assert.ok(report && typeof report === 'object' && !Array.isArray(report));
  assert.equal(report.schema, 1);
  assert.equal(report.probe, 'm0-context-bridge-spike');
  assert.equal(report.status, 'PASS');
  assert.ok(DECISIONS.has(report.decision), 'decision must be go/no-go/blocked');
  assert.equal(report.compatible, false);
  assert.equal(report.productionContextBridge, 'NOT_IMPLEMENTED');
  assert.equal(report.compatibilityGate, 'OPEN');
  assert.equal(report.transport, 'shared-dom-synchronous-hmac');

  const checkpointOne = validateCheckpointOne(report);
  const checkpointTwo = validateCheckpointTwo(report, checkpointOne);
  if (checkpointOne.result === false) {
    assert.equal(checkpointTwo, 'NOT_RUN',
      'failed checkpoint 1 must not be followed by checkpoint 2 feature evidence');
  }
  if (report.decision === 'go' || report.framePolicy !== undefined) {
    validateFramePolicy(report);
  }

  assert.ok(report.native && typeof report.native === 'object' && !Array.isArray(report.native));
  for (const key of ['reportsAccepted', 'reportsRejected', 'duplicateReportsRejected',
    'staleGrantRejected', 'childReportsRejected', 'grantsIssued', 'documentHandshakes']) {
    assert.ok(Number.isSafeInteger(report.native[key]) && report.native[key] >= 0,
      `native.${key}`);
  }
  assert.equal(typeof report.native.grantRotated, 'boolean');
  assert.equal(typeof report.native.secretLeakDetected, 'boolean');
  if (report.decision !== 'no-go') {
    assert.equal(report.native.secretLeakDetected, false, 'secret leak blocks a go/blocked claim');
  }
  if (report.decision === 'go') {
    assert.equal(report.native.reportsAccepted >= 3, true, 'three accepted reports required');
    assert.equal(report.native.grantRotated, true, 'grant rotation required');
    assert.ok(report.native.staleGrantRejected >= 1, 'stale grant rejection required');
    assert.equal(checkpointOne.result, true, 'go requires checkpoint 1');
    assert.notEqual(checkpointTwo, 'NOT_RUN', 'go requires checkpoint 2');
    assert.equal(checkpointTwo.result, true, 'go requires checkpoint 2');
  }
  if (report.decision === 'no-go') {
    assert.equal(checkpointOne.result === false ||
      (checkpointTwo !== 'NOT_RUN' && checkpointTwo.result === false),
      true, 'no-go requires a failed checkpoint');
  }
  if (report.decision === 'blocked') {
    assert.equal(checkpointOne.result, true, 'blocked requires checkpoint 1 evidence');
    assert.equal(checkpointTwo, 'NOT_RUN', 'blocked leaves checkpoint 2 NOT RUN');
    assert.equal(typeof report.blockedReason, 'string', 'blockedReason required');
    assert.ok(report.blockedReason.length > 0, 'blockedReason required');
  }

  assert.ok(report.preload && typeof report.preload === 'object');
  assert.equal(report.preload.source, 'fixtures/oracle/preload.cjs');
  assert.ok(isHex64(report.preload.sha256));
  assert.ok(Number.isSafeInteger(report.preload.bytes) && report.preload.bytes > 0);

  assert.ok(report.oracleFixture && typeof report.oracleFixture === 'object');
  assert.equal(report.oracleFixture.path, 'fixtures/oracle');
  assert.ok(isHex64(report.oracleFixture.hash));
  assert.ok(report.oracleFixture.baselineHash === null ||
    isHex64(report.oracleFixture.baselineHash));
  assert.ok(['NOT_RUN', true, false].includes(report.oracleFixture.match));
  if (report.oracleFixture.match === true) {
    assert.equal(report.oracleFixture.hash, report.oracleFixture.baselineHash);
  }
  if (report.decision === 'go') {
    assert.notEqual(report.oracleFixture.match, false,
      'a go cannot carry a baseline fixture mismatch');
  }

  assert.ok(report.hashes && typeof report.hashes === 'object');
  for (const key of ['codec', 'pageShim', 'isolatedBridge',
    'checkpointPage', 'negativePage', 'child', 'framesPage', 'sameOriginChild']) {
    assert.ok(isHex64(report.hashes[key]), `hashes.${key}`);
  }

  assert.ok(report.environment && typeof report.environment === 'object');
  for (const key of ['os', 'webkit', 'sdk', 'arch', 'node', 'electronOracle']) {
    assert.equal(typeof report.environment[key], 'string', `environment.${key}`);
    assert.ok(report.environment[key].length > 0, `environment.${key}`);
  }
  assert.equal(report.environment.electronOracle, '44.7.0');

  assert.ok(Array.isArray(report.limitations) && report.limitations.length > 0);
  for (const item of report.limitations) assert.equal(typeof item, 'string');
  assert.equal(report.sourceHashPreserved, true, 'fixture source hashes must be preserved');

  validateNoRawSecretKeys(report, 'report');
  return report;
}

module.exports = { validateM0ContextBridgeEvidence };
