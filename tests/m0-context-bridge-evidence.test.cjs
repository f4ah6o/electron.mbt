'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { validateM0ContextBridgeEvidence } = require('../scripts/m0-context-bridge-evidence.cjs');

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);

function oracleObservation() {
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

function checkpointState(overrides) {
  return Object.assign({
    firstScriptAttempted: true,
    apiAvailable: true,
    apiError: null,
    syncValue: 42,
    syncValueType: 'number',
    syncThrow: true,
    syncThrowError: { name: 'Error', typeofValue: 'object', objectTag: '[object Error]', pageRealmInstance: true },
    preSeededForgedAccepted: false,
    preSeededFailClosed: true,
    listenerForgedAccepted: false,
    listenerFailClosed: true,
    captureBlockedForgedAccepted: false,
    captureBlockedFailClosed: true,
    afterListenerForgedAccepted: false,
    afterListenerResult: 'typed-error',
    reportSent: true,
    reportError: null,
    bridgeInternalsHidden: true,
    nativeHandlersHidden: true,
    complete: true,
  }, overrides || {});
}

function negativeState(overrides) {
  return Object.assign({
    complete: true,
    nestedReentrant: true,
    callbackThrowReconstructed: true,
    bridgeUnaffected: true,
    unsupportedRejected: true,
    oversizeRejected: true,
    cyclicRejected: true,
    childAccessDenied: true,
    childMessageObserved: true,
    childOpaqueOrigin: true,
    childNotRelayed: true,
    handlerHidden: true,
    internalsHidden: true,
    secretVisible: false,
  }, overrides || {});
}

function checkpointOne(overrides) {
  return Object.assign({
    firstScript: true,
    syncValue: true,
    syncThrow: true,
    syncValueThenable: false,
    forgery: {
      preSeededForgedAccepted: false,
      listenerForgedAccepted: false,
      captureBlockedForgedAccepted: false,
      afterListenerForgedAccepted: false,
    },
    secretVisible: false,
    result: true,
  }, overrides || {});
}

function checkpointTwo(overrides) {
  return Object.assign({
    oracleFirst: true,
    oracleReload: true,
    negative: true,
    navigationRevocation: true,
    result: true,
  }, overrides || {});
}

function framePolicy(overrides) {
  return Object.assign({
    version: 1,
    observationComplete: true,
    hypothesis: 'same-origin child inherits the parent page-world API; '
      + 'opaque/sandboxed child is denied',
    hypothesisSupported: true,
    sameOriginChild: {
      messageObserved: true,
      ownApiType: 'undefined',
      parentApiType: 'object',
      access: true,
      accessError: null,
      originMatches: true,
      notRelayed: true,
      syncValue: 42,
      syncValueType: 'number',
      syncValueError: null,
      syncThrow: true,
      throwName: 'Error',
      throwMessage: 'pinned',
      childRealmError: false,
      parentRealmError: true,
      handlerHidden: true,
    },
    sandboxedChild: {
      messageObserved: true,
      opaqueOrigin: true,
      accessDenied: true,
      handlerHidden: true,
      notRelayed: true,
    },
    nativeChildReportsRejected: 0,
  }, overrides || {});
}

function deniedFramePolicy() {
  return framePolicy({
    hypothesisSupported: false,
    sameOriginChild: {
      messageObserved: true,
      ownApiType: 'undefined',
      parentApiType: 'object',
      access: false,
      accessError: 'SecurityError: cross-origin access denied',
      originMatches: true,
      notRelayed: true,
      syncValue: null,
      syncValueType: 'undefined',
      syncValueError: null,
      syncThrow: false,
      throwName: null,
      throwMessage: null,
      childRealmError: null,
      parentRealmError: null,
      handlerHidden: true,
    },
  });
}

function sample(overrides) {
  const report = {
    schema: 1,
    probe: 'm0-context-bridge-spike',
    status: 'PASS',
    decision: 'go',
    compatible: false,
    productionContextBridge: 'NOT_IMPLEMENTED',
    compatibilityGate: 'OPEN',
    transport: 'shared-dom-synchronous-hmac',
    preload: { source: 'fixtures/oracle/preload.cjs', sha256: HASH_A, bytes: 1234 },
    oracleFixture: { path: 'fixtures/oracle', hash: HASH_B, baselineHash: HASH_B, match: true },
    checkpoint1: checkpointOne(),
    checkpoint2: checkpointTwo(),
    framePolicy: framePolicy(),
    observations: {
      checkpoint1: checkpointState(),
      oracleFirst: oracleObservation(),
      negative: negativeState(),
      oracleReload: oracleObservation(),
    },
    native: {
      reportsAccepted: 3,
      reportsRejected: 1,
      duplicateReportsRejected: 0,
      staleGrantRejected: 1,
      childReportsRejected: 0,
      grantsIssued: 4,
      grantRotated: true,
      documentHandshakes: 4,
      secretLeakDetected: false,
    },
    environment: {
      os: 'macOS 15.0', webkit: '620.1.16', sdk: '15.0',
      arch: 'arm64', node: 'v24.21.0', electronOracle: '44.7.0',
    },
    hashes: {
      codec: HASH_A, pageShim: HASH_A, isolatedBridge: HASH_A,
      checkpointPage: HASH_A, negativePage: HASH_A, child: HASH_A,
      framesPage: HASH_A, sameOriginChild: HASH_A,
    },
    limitations: ['test-only shared-DOM/HMAC candidate; not Electron contextBridge'],
    sourceHashPreserved: true,
  };
  return Object.assign(report, overrides || {});
}

test('What: a complete B5 go report is accepted only with derived checkpoint evidence', () => {
  const report = sample();
  assert.equal(validateM0ContextBridgeEvidence(report), report);
});

test('What: a failed checkpoint 1 report is a valid no-go with checkpoint 2 NOT RUN', () => {
  const observed = checkpointState({ syncValue: 0, syncThrow: false, syncThrowError: null });
  const report = sample({
    decision: 'no-go',
    checkpoint1: checkpointOne({ syncValue: false, syncThrow: false, result: false }),
    checkpoint2: 'NOT_RUN',
    observations: {
      checkpoint1: observed, oracleFirst: null, negative: null, oracleReload: null,
    },
    native: Object.assign({}, sample().native, {
      reportsAccepted: 1, staleGrantRejected: 0, grantRotated: false,
    }),
  });
  assert.equal(validateM0ContextBridgeEvidence(report), report);
});

test('What: a failed first-script observation with an absent sync value is a valid no-go', () => {
  const observed = checkpointState({
    apiAvailable: false, syncValue: null, syncValueType: 'undefined',
    syncThrow: false, syncThrowError: null,
    bridgeInternalsHidden: false, nativeHandlersHidden: false,
  });
  const report = sample({
    decision: 'no-go',
    checkpoint1: checkpointOne({
      firstScript: false, syncValue: false, syncThrow: false,
      syncValueThenable: true, result: false,
    }),
    checkpoint2: 'NOT_RUN',
    observations: {
      checkpoint1: observed, oracleFirst: null, negative: null, oracleReload: null,
    },
    native: Object.assign({}, sample().native, {
      reportsAccepted: 0, staleGrantRejected: 0, grantRotated: false,
    }),
    blockedReason: 'window.fixture was not available at the first script',
  });
  assert.equal(validateM0ContextBridgeEvidence(report), report);
});

test('What: a blocked report needs checkpoint 1 evidence and a named reason', () => {
  const report = sample({
    decision: 'blocked',
    checkpoint2: 'NOT_RUN',
    observations: {
      checkpoint1: checkpointState(), oracleFirst: null, negative: null, oracleReload: null,
    },
    native: Object.assign({}, sample().native, {
      reportsAccepted: 0, staleGrantRejected: 0, grantRotated: false,
    }),
    blockedReason: 'checkpoint 1 liveness report lane did not answer',
  });
  assert.equal(validateM0ContextBridgeEvidence(report), report);
  assert.throws(() => validateM0ContextBridgeEvidence(sample({
    decision: 'blocked',
    checkpoint2: 'NOT_RUN',
    observations: {
      checkpoint1: checkpointState(), oracleFirst: null, negative: null, oracleReload: null,
    },
    blockedReason: '',
  })), /blockedReason/);
});

test('What: promoted compatibility claims and raw secrets are rejected', () => {
  const cases = [
    o => { o.compatible = true; },
    o => { o.productionContextBridge = 'IMPLEMENTED'; },
    o => { o.compatibilityGate = 'CLOSED'; },
    o => { o.secret = 'raw'; },
    o => { o.native.grant = 'raw'; },
    o => { o.observations.checkpoint1.nonce = 'raw'; },
  ];
  for (const mutate of cases) {
    const report = sample();
    mutate(report);
    assert.throws(() => validateM0ContextBridgeEvidence(report));
  }
});

test('What: a go with a failed derivation, stale grant or leaked secret is rejected', () => {
  const mutations = [
    o => { o.checkpoint2.oracleFirst = false; },
    o => { o.checkpoint2.navigationRevocation = false; },
    o => { o.checkpoint2.result = false; },
    o => { o.native.staleGrantRejected = 0; },
    o => { o.native.grantRotated = false; },
    o => { o.native.secretLeakDetected = true; },
    o => { o.native.reportsAccepted = 2; },
    o => { o.observations.oracleFirst.syncValue = 41; },
    o => { o.observations.checkpoint1.preSeededForgedAccepted = true; },
    o => { o.checkpoint1.result = false; },
    o => { o.checkpoint1.syncValue = false; },
    o => { o.oracleFixture.match = false; },
    o => { o.sourceHashPreserved = false; },
    o => { o.hashes.codec = 'not-a-hash'; },
    o => { delete o.environment.sdk; },
    o => { o.observations.negative.childAccessDenied = false; },
    o => { delete o.observations.checkpoint1; },
    o => { o.decision = 'maybe'; },
  ];
  for (const mutate of mutations) {
    const report = sample();
    mutate(report);
    assert.throws(() => validateM0ContextBridgeEvidence(report));
  }
});

test('What: a no-go cannot claim all checkpoints passed and a failed checkpoint cannot add feature evidence', () => {
  const allPassNoGo = sample({ decision: 'no-go' });
  assert.throws(() => validateM0ContextBridgeEvidence(allPassNoGo), /no-go/);

  const observed = checkpointState({ syncValue: 0, syncThrow: false, syncThrowError: null });
  const falseCheckpointWithTwo = sample({
    decision: 'no-go',
    checkpoint1: checkpointOne({ syncValue: false, syncThrow: false, result: false }),
    checkpoint2: checkpointTwo(),
    observations: {
      checkpoint1: observed,
      oracleFirst: oracleObservation(),
      negative: negativeState(),
      oracleReload: oracleObservation(),
    },
  });
  assert.throws(() => validateM0ContextBridgeEvidence(falseCheckpointWithTwo),
    /failed checkpoint 1/);
});

test('What: a same-origin child denial is a valid main-frame-only frame observation', () => {
  const report = sample({ framePolicy: deniedFramePolicy() });
  assert.equal(validateM0ContextBridgeEvidence(report), report);
  assert.equal(report.framePolicy.hypothesisSupported, false);
});

test('What: incomplete or inconsistent frame/origin evidence is rejected', () => {
  const incomplete = sample({ framePolicy: framePolicy({ observationComplete: false }) });
  assert.throws(() => validateM0ContextBridgeEvidence(incomplete),
    /observationComplete/);

  const missingReport = sample();
  missingReport.framePolicy.sameOriginChild.messageObserved = false;
  assert.throws(() => validateM0ContextBridgeEvidence(missingReport), /report/);

  const sandboxDenied = sample();
  sandboxDenied.framePolicy.sandboxedChild.accessDenied = false;
  assert.throws(() => validateM0ContextBridgeEvidence(sandboxDenied), /sandboxedChild/);

  const handlerVisible = sample();
  handlerVisible.framePolicy.sameOriginChild.handlerHidden = false;
  assert.throws(() => validateM0ContextBridgeEvidence(handlerVisible), /handler/);

  const originMismatch = sample();
  originMismatch.framePolicy.sameOriginChild.originMatches = false;
  assert.throws(() => validateM0ContextBridgeEvidence(originMismatch), /origin/);

  const derivedMismatch = sample();
  derivedMismatch.framePolicy.hypothesisSupported = false;
  assert.throws(() => validateM0ContextBridgeEvidence(derivedMismatch),
    /hypothesisSupported/);

  const missingPolicy = sample();
  delete missingPolicy.framePolicy;
  assert.throws(() => validateM0ContextBridgeEvidence(missingPolicy), /framePolicy/);
});
