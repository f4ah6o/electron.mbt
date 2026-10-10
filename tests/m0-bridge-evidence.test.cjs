'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { validateM0Evidence } = require('../scripts/m0-bridge-evidence.cjs');

function sample() {
  const page = {
    firstScriptAttempted: true,
    privateGlobalHidden: true,
    nativeReplyHandlerHidden: true,
    synchronousValue: true,
    synchronousThrow: true,
    callbackByPageId: true,
    pageCanForgeDOMReply: true,
  };
  const isolated = {
    isolatedMarker: true, primordialIntact: true,
    requests: 6, callbackAttempts: 3,
    nativeReplyPromise: true, nativeReplySettled: true,
  };
  return {
    probe: 'm0-isolated-sync-feasibility', status: 'PASS',
    compatible: false, contextBridge: 'NOT_IMPLEMENTED', compatibilityGate: 'OPEN',
    documentLoads: 2, nativeReplyCount: 2,
    withReplyReturnedPromise: true, nativeReplySettled: true,
    newDocumentScriptReinitialized: true,
    candidate: {
      transport: 'shared-page-mutable-DOM-event',
      pageAuthoredProxy: true, synchronousPrimitiveObserved: true,
      synchronousThrowObserved: true, callbackByIdOnlyObserved: true,
      pageCanForgeResponse: true, privilegedSenderAttested: false,
      secureContextBridgeVerified: false, realCallbackIdentityVerified: false,
      promiseProxyVerified: false, frozenCrossRealmCopyVerified: false,
    },
    firstDocument: { page: { ...page }, isolated: { ...isolated } },
    secondDocument: { page: { ...page }, isolated: { ...isolated } },
    environment: { os: 'macOS test fixture', webkit: 'test version' },
  };
}

test('What: an observed sync DOM candidate must keep the M0 compatibility gate open', () => {
  const observed = validateM0Evidence(sample());
  assert.equal(observed.candidate.synchronousPrimitiveObserved, true);
  assert.equal(observed.candidate.secureContextBridgeVerified, false);
  assert.equal(observed.compatibilityGate, 'OPEN');
});

test('What: candidate failure remains a valid measured outcome rather than a fake pass', () => {
  const report = sample();
  report.candidate.synchronousPrimitiveObserved = false;
  report.firstDocument.page.synchronousValue = false;
  report.firstDocument.isolated.requests = 0;
  report.newDocumentScriptReinitialized = false;
  assert.doesNotThrow(() => validateM0Evidence(report));
});

test('What: missing observations and compatibility elevation are rejected', () => {
  for (const mutate of [
    r => { r.compatible = true; },
    r => { r.compatibilityGate = 'verified'; },
    r => { r.contextBridge = 'IMPLEMENTED'; },
    r => { r.candidate.secureContextBridgeVerified = true; },
    r => { r.candidate.privilegedSenderAttested = true; },
    r => { r.candidate.realCallbackIdentityVerified = true; },
    r => { r.candidate.pageAuthoredProxy = false; },
    r => { r.firstDocument.page.privateGlobalHidden = false; },
    r => { r.secondDocument.page.nativeReplyHandlerHidden = false; },
    r => { r.firstDocument.isolated.primordialIntact = false; },
    r => { r.firstDocument.isolated.requests = -1; },
    r => { r.documentLoads = 1; },
    r => { delete r.candidate.pageCanForgeResponse; },
    r => { delete r.firstDocument.page.synchronousThrow; },
    r => { r.withReplyReturnedPromise = null; },
  ]) {
    const report = sample();
    mutate(report);
    assert.throws(() => validateM0Evidence(report));
  }
});
