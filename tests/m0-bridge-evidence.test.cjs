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
    pageTriggeredNativeMessage: true,
    childRelay: {
      received: true, sourceMatches: true, opaqueOrigin: true, forwarded: true,
    },
  };
  const isolated = {
    isolatedMarker: true, primordialIntact: true,
    requests: 8, callbackAttempts: 3,
    nativePageRequestCount: 1, nativePageReplySettled: true,
    nativeChildRelayRequestCount: 1, nativeChildRelayReplySettled: true,
    nativeReplyPromise: true, nativeReplySettled: true,
    grantProbeSettled: true, grantEchoAccepted: true,
    invalidGrantRejected: true, staleGrantRejected: false,
  };
  return {
    probe: 'm0-isolated-sync-feasibility', status: 'PASS',
    compatible: false, contextBridge: 'NOT_IMPLEMENTED', compatibilityGate: 'OPEN',
    documentLoads: 2, nativeReplyCount: 6,
    documentStartNativeMessageCount: 2, pageInducedNativeMessageCount: 4,
    nativeGrantIssuedCount: 2, nativeGrantAcceptedCount: 2,
    nativeGrantDomTriggeredAcceptedCount: 4,
    nativeGrantInvalidRejectedCount: 2, nativeGrantStaleRejectedCount: 1,
    nativeSubframeDeniedCount: 2,
    withReplyReturnedPromise: true, nativeReplySettled: true,
    newDocumentScriptReinitialized: true,
    candidate: {
      transport: 'shared-page-mutable-DOM-event',
      pageAuthoredProxy: true, synchronousPrimitiveObserved: true,
      directSubframeNativeDenied: true,
      synchronousThrowObserved: true, callbackByIdOnlyObserved: true,
      pageCanForgeResponse: true, pageCanInduceNativeMessage: true,
      pageInducedWithValidIsolatedGrant: true,
      sandboxedChildCanRelayGrantedNativeEcho: true,
      pageInitiatorAuthenticated: false,
      documentGrantRotated: true, isolatedGrantEchoObserved: true,
      invalidGrantRejected: true, staleGrantReplayRejected: true,
      privilegedSenderAttested: false,
      secureContextBridgeVerified: false, realCallbackIdentityVerified: false,
      promiseProxyVerified: false, frozenCrossRealmCopyVerified: false,
    },
    firstDocument: { page: { ...page, childRelay: { ...page.childRelay } },
      isolated: { ...isolated },
      subframe: { attempted: true, replyPromise: true, settled: true,
        denied: true, rejectionCodeObserved: true },
      subframePage: { postMessageSent: true, nativeReplyHandlerHidden: true } },
    secondDocument: { page: { ...page, childRelay: { ...page.childRelay } },
      isolated: { ...isolated, staleGrantRejected: true },
      subframe: { attempted: true, replyPromise: true, settled: true,
        denied: true, rejectionCodeObserved: true },
      subframePage: { postMessageSent: true, nativeReplyHandlerHidden: true } },
    environment: { os: 'macOS test fixture', webkit: 'test version' },
  };
}

test('What: an observed sync DOM candidate must keep the M0 compatibility gate open', () => {
  const observed = validateM0Evidence(sample());
  assert.equal(observed.candidate.synchronousPrimitiveObserved, true);
  assert.equal(observed.candidate.secureContextBridgeVerified, false);
  assert.equal(observed.candidate.pageCanInduceNativeMessage, true);
  assert.equal(observed.candidate.pageInducedWithValidIsolatedGrant, true);
  assert.equal(observed.nativeGrantDomTriggeredAcceptedCount, 4);
  assert.equal(observed.candidate.sandboxedChildCanRelayGrantedNativeEcho, true);
  assert.equal(observed.compatible, false);
  assert.equal(observed.candidate.pageInitiatorAuthenticated, false);
  assert.equal(observed.candidate.staleGrantReplayRejected, true);
  assert.equal(observed.nativeGrantStaleRejectedCount, 1);
  assert.equal(observed.nativeSubframeDeniedCount, 2);
  assert.equal(observed.candidate.directSubframeNativeDenied, true);
  assert.equal(observed.compatibilityGate, 'OPEN');
});

test('What: candidate failure remains a valid measured outcome rather than a fake pass', () => {
  const report = sample();
  report.candidate.synchronousPrimitiveObserved = false;
  report.firstDocument.page.synchronousValue = false;
  assert.doesNotThrow(() => validateM0Evidence(report));
});

test('What: missing observations and compatibility elevation are rejected', () => {
  for (const mutate of [
    r => { r.compatible = true; },
    r => { r.compatibilityGate = 'verified'; },
    r => { r.contextBridge = 'IMPLEMENTED'; },
    r => { r.candidate.secureContextBridgeVerified = true; },
    r => { r.candidate.privilegedSenderAttested = true; },
    r => { r.candidate.directSubframeNativeDenied = false; },
    r => { delete r.candidate.directSubframeNativeDenied; },
    r => { r.nativeSubframeDeniedCount = 1; },
    r => { r.firstDocument.subframe.attempted = false; },
    r => { r.firstDocument.subframe.replyPromise = false; },
    r => { r.firstDocument.subframe.settled = false; },
    r => { r.firstDocument.subframe.denied = false; },
    r => { r.firstDocument.subframe.rejectionCodeObserved = false; },
    r => { r.secondDocument.subframe.rejectionCodeObserved = false; },
    r => { r.candidate.pageInitiatorAuthenticated = true; },
    r => { r.candidate.pageInducedWithValidIsolatedGrant = false; },
    r => { r.candidate.pageInducedWithValidIsolatedGrant = 1; },
    r => { delete r.candidate.pageInducedWithValidIsolatedGrant; },
    r => { r.candidate.sandboxedChildCanRelayGrantedNativeEcho = 1; },
    r => { delete r.candidate.sandboxedChildCanRelayGrantedNativeEcho; },
    r => { r.nativeGrantIssuedCount = 1; },
    r => { r.firstDocument.isolated.grantProbeSettled = false; },
    r => { r.firstDocument.isolated.staleGrantRejected = true; },
    r => { r.candidate.realCallbackIdentityVerified = true; },
    r => { r.candidate.pageAuthoredProxy = false; },
    r => { r.firstDocument.page.privateGlobalHidden = false; },
    r => { r.secondDocument.page.nativeReplyHandlerHidden = false; },
    r => { r.firstDocument.subframePage.postMessageSent = false; },
    r => { r.secondDocument.subframePage.nativeReplyHandlerHidden = false; },
    r => { delete r.firstDocument.page.childRelay; },
    r => { r.firstDocument.page.childRelay.received = null; },
    r => { r.firstDocument.isolated.primordialIntact = false; },
    r => { r.firstDocument.isolated.requests = -1; },
    r => { r.documentLoads = 1; },
    r => { delete r.candidate.pageCanForgeResponse; },
    r => { delete r.firstDocument.page.synchronousThrow; },
    r => { delete r.firstDocument.page.pageTriggeredNativeMessage; },
    r => { r.withReplyReturnedPromise = null; },
  ]) {
    const report = sample();
    mutate(report);
    assert.throws(() => validateM0Evidence(report));
  }
});

test('What: inconsistent M0 aggregate claims cannot pass as measured native evidence', () => {
  for (const mutate of [
    r => { r.candidate.synchronousPrimitiveObserved = false; },
    r => { r.newDocumentScriptReinitialized = false; },
    r => { r.firstDocument.isolated.requests = 0; },
    r => { r.pageInducedNativeMessageCount = 1; },
    r => { r.documentStartNativeMessageCount = 1; },
    r => { r.nativeReplyCount = 3; },
    r => { r.candidate.pageCanInduceNativeMessage = false; },
    r => { r.firstDocument.page.pageTriggeredNativeMessage = false; },
    r => { r.secondDocument.isolated.nativePageRequestCount = 0; },
    r => { r.firstDocument.isolated.nativePageReplySettled = false; },
    r => { r.firstDocument.isolated.nativeChildRelayReplySettled = false; },
    r => { r.firstDocument.isolated.nativeChildRelayRequestCount = -1; },
    r => { r.firstDocument.page.childRelay.opaqueOrigin = false; },
    r => { r.secondDocument.page.childRelay.sourceMatches = false; },
    r => { r.candidate.sandboxedChildCanRelayGrantedNativeEcho = false; },
    r => { r.nativeReplySettled = false; },
    r => { r.nativeGrantAcceptedCount = 1; },
    r => { r.nativeGrantDomTriggeredAcceptedCount = 1; },
    r => { r.nativeGrantInvalidRejectedCount = 1; },
    r => { r.nativeGrantStaleRejectedCount = 0; },
    r => { r.candidate.isolatedGrantEchoObserved = false; },
    r => { r.candidate.invalidGrantRejected = false; },
    r => { r.candidate.staleGrantReplayRejected = false; },
  ]) {
    const report = sample();
    mutate(report);
    assert.throws(() => validateM0Evidence(report));
  }
});

test('What: a failed page-induced native echo remains an explicit negative observation', () => {
  const report = sample();
  report.candidate.pageCanInduceNativeMessage = false;
  report.pageInducedNativeMessageCount = 2;
  report.nativeGrantDomTriggeredAcceptedCount = 2;
  report.candidate.pageInducedWithValidIsolatedGrant = false;
  report.nativeReplyCount = 4;
  for (const document of [report.firstDocument, report.secondDocument]) {
    document.page.pageTriggeredNativeMessage = false;
    document.isolated.nativePageRequestCount = 0;
    document.isolated.nativePageReplySettled = false;
  }
  assert.doesNotThrow(() => validateM0Evidence(report));
});

test('What: a sandboxed child relay failure does not become a false native success', () => {
  const report = sample();
  report.candidate.sandboxedChildCanRelayGrantedNativeEcho = false;
  report.pageInducedNativeMessageCount = 2;
  report.nativeGrantDomTriggeredAcceptedCount = 2;
  report.nativeReplyCount = 4;
  for (const document of [report.firstDocument, report.secondDocument]) {
    document.page.childRelay.forwarded = false;
    document.isolated.nativeChildRelayRequestCount = 0;
    document.isolated.nativeChildRelayReplySettled = false;
  }
  assert.doesNotThrow(() => validateM0Evidence(report));
  assert.equal(report.candidate.privilegedSenderAttested, false);
  assert.equal(report.compatibilityGate, 'OPEN');
});

test('What: a rejected stale grant is an observed negative, not a fake compatibility PASS', () => {
  const report = sample();
  report.candidate.staleGrantReplayRejected = false;
  report.nativeGrantStaleRejectedCount = 0;
  report.secondDocument.isolated.staleGrantRejected = false;
  assert.doesNotThrow(() => validateM0Evidence(report));
  assert.equal(report.compatibilityGate, 'OPEN');
});

test('What: document grant rotation never elevates sender attestation', () => {
  const report = sample();
  report.candidate.documentGrantRotated = false;
  report.candidate.staleGrantReplayRejected = false;
  report.nativeGrantStaleRejectedCount = 0;
  report.secondDocument.isolated.staleGrantRejected = false;
  assert.doesNotThrow(() => validateM0Evidence(report));
  assert.equal(report.candidate.privilegedSenderAttested, false);
});
