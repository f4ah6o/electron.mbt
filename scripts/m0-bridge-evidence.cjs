'use strict';
const assert = require('node:assert/strict');

function validateM0Evidence(report) {
  assert.equal(report?.probe, 'm0-isolated-sync-feasibility');
  assert.equal(report?.status, 'PASS');
  assert.equal(report?.compatible, false);
  assert.equal(report?.contextBridge, 'NOT_IMPLEMENTED');
  assert.equal(report?.compatibilityGate, 'OPEN');
  assert.equal(report?.documentLoads, 2);
  assert.ok(Number.isSafeInteger(report.nativeReplyCount) && report.nativeReplyCount >= 0);
  assert.ok(Number.isSafeInteger(report.documentStartNativeMessageCount) &&
    report.documentStartNativeMessageCount >= 0);
  assert.ok(Number.isSafeInteger(report.pageInducedNativeMessageCount) &&
    report.pageInducedNativeMessageCount >= 0);
  assert.equal(report.nativeReplyCount,
    report.documentStartNativeMessageCount + report.pageInducedNativeMessageCount);
  assert.ok(Number.isSafeInteger(report.nativeSubframeDeniedCount));
  assert.equal(report.nativeSubframeDeniedCount, report.documentLoads);
  for (const name of [
    'nativeGrantIssuedCount', 'nativeGrantAcceptedCount',
    'nativeGrantInvalidRejectedCount', 'nativeGrantStaleRejectedCount',
  ]) assert.ok(Number.isSafeInteger(report[name]) && report[name] >= 0, name);
  assert.equal(report.nativeGrantIssuedCount, report.documentLoads);
  assert.ok(Number.isSafeInteger(report.nativeGrantDomTriggeredAcceptedCount) &&
    report.nativeGrantDomTriggeredAcceptedCount >= 0);
  assert.equal(report.nativeGrantDomTriggeredAcceptedCount,
    report.pageInducedNativeMessageCount);
  assert.equal(typeof report.withReplyReturnedPromise, 'boolean');
  assert.equal(typeof report.nativeReplySettled, 'boolean');
  assert.equal(typeof report.newDocumentScriptReinitialized, 'boolean');
  for (const document of [report.firstDocument, report.secondDocument]) {
    assert.equal(document?.page?.firstScriptAttempted, true);
    assert.equal(document.page.privateGlobalHidden, true);
    assert.equal(document.page.nativeReplyHandlerHidden, true);
    for (const name of ['received', 'sourceMatches', 'opaqueOrigin', 'forwarded']) {
      assert.equal(typeof document.page.childRelay?.[name], 'boolean', name);
    }
    // Why not: page-owned message observations do not attest the child to native.
    assert.equal(document.subframePage?.postMessageSent, true);
    assert.equal(document.subframePage.nativeReplyHandlerHidden, true);
    assert.equal(document.isolated?.isolatedMarker, true);
    assert.equal(document.isolated.primordialIntact, true);
    assert.ok(Number.isSafeInteger(document.isolated.requests));
    assert.ok(document.isolated.requests >= 0);
    assert.ok(Number.isSafeInteger(document.isolated.callbackAttempts));
    assert.ok(document.isolated.callbackAttempts >= 0);
    assert.ok(Number.isSafeInteger(document.isolated.nativePageRequestCount));
    assert.ok(document.isolated.nativePageRequestCount >= 0);
    assert.equal(typeof document.isolated.nativePageReplySettled, 'boolean');
    assert.ok(Number.isSafeInteger(document.isolated.nativeChildRelayRequestCount) &&
      document.isolated.nativeChildRelayRequestCount >= 0);
    assert.equal(typeof document.isolated.nativeChildRelayReplySettled, 'boolean');
    for (const field of [
      'grantProbeSettled', 'grantEchoAccepted', 'invalidGrantRejected', 'staleGrantRejected',
    ]) assert.equal(typeof document.isolated[field], 'boolean', field);
    assert.equal(document.isolated.grantProbeSettled, true);
    for (const key of [
      'attempted', 'replyPromise', 'settled', 'denied', 'rejectionCodeObserved',
    ]) assert.equal(typeof document.subframe?.[key], 'boolean', key);
    for (const property of [
      'synchronousValue', 'synchronousThrow', 'callbackByPageId', 'pageCanForgeDOMReply',
      'pageTriggeredNativeMessage',
    ]) assert.equal(typeof document.page[property], 'boolean');
    for (const property of ['nativeReplyPromise', 'nativeReplySettled']) {
      assert.equal(typeof document.isolated[property], 'boolean');
    }
  }
  const candidate = report.candidate;
  assert.equal(candidate?.transport, 'shared-page-mutable-DOM-event');
  assert.equal(candidate?.pageAuthoredProxy, true);
  assert.equal(candidate?.privilegedSenderAttested, false);
  // Why not: a verified immediate native frame does not prove who initiated a shared-DOM event.
  assert.equal(candidate?.directSubframeNativeDenied, true);
  assert.equal(candidate.directSubframeNativeDenied,
    report.nativeSubframeDeniedCount === report.documentLoads &&
    [report.firstDocument, report.secondDocument].every(d =>
      d.subframe.attempted && d.subframe.replyPromise && d.subframe.settled &&
      d.subframe.denied && d.subframe.rejectionCodeObserved));
  assert.equal(candidate?.pageInitiatorAuthenticated, false);
  assert.equal(typeof candidate?.sandboxedChildCanRelayGrantedNativeEcho, 'boolean');
  for (const field of [
    'documentGrantRotated', 'isolatedGrantEchoObserved',
    'invalidGrantRejected', 'staleGrantReplayRejected',
  ]) assert.equal(typeof candidate[field], 'boolean', field);
  assert.equal(candidate?.secureContextBridgeVerified, false);
  assert.equal(candidate?.realCallbackIdentityVerified, false);
  assert.equal(candidate?.promiseProxyVerified, false);
  assert.equal(candidate?.frozenCrossRealmCopyVerified, false);
  for (const property of [
    'synchronousPrimitiveObserved', 'synchronousThrowObserved',
    'callbackByIdOnlyObserved', 'pageCanForgeResponse',
    'pageCanInduceNativeMessage',
  ]) assert.equal(typeof candidate[property], 'boolean');
  assert.equal(candidate.synchronousPrimitiveObserved,
    report.firstDocument.page.synchronousValue &&
    report.firstDocument.page.synchronousThrow &&
    report.firstDocument.isolated.requests >= 2);
  assert.equal(report.newDocumentScriptReinitialized,
    report.firstDocument.isolated.requests === report.secondDocument.isolated.requests &&
    report.firstDocument.isolated.requests > 0);
  assert.equal(candidate.pageCanInduceNativeMessage,
    report.firstDocument.page.pageTriggeredNativeMessage &&
    report.secondDocument.page.pageTriggeredNativeMessage &&
    report.firstDocument.isolated.nativePageRequestCount === 1 &&
    report.secondDocument.isolated.nativePageRequestCount === 1 &&
    report.firstDocument.isolated.nativePageReplySettled &&
    report.secondDocument.isolated.nativePageReplySettled &&
    report.pageInducedNativeMessageCount >= report.documentLoads);
  const documents = [report.firstDocument, report.secondDocument];
  const settledGrantedEchoes = documents.reduce((count, document) =>
    count + Number(document.isolated.nativePageReplySettled) +
    Number(document.isolated.nativeChildRelayReplySettled), 0);
  assert.equal(report.pageInducedNativeMessageCount, settledGrantedEchoes);
  // Why not: native validates the immediate main isolated frame and grant,
  // not the original frame initiating a page-owned postMessage or DOM event.
  assert.equal(candidate?.pageInducedWithValidIsolatedGrant,
    candidate.pageCanInduceNativeMessage &&
    report.nativeGrantDomTriggeredAcceptedCount >= report.documentLoads);
  assert.equal(candidate.sandboxedChildCanRelayGrantedNativeEcho,
    documents.every(document =>
      document.page.childRelay.received &&
      document.page.childRelay.sourceMatches &&
      document.page.childRelay.opaqueOrigin &&
      document.page.childRelay.forwarded &&
      document.subframePage.postMessageSent &&
      document.subframePage.nativeReplyHandlerHidden &&
      document.isolated.nativeChildRelayRequestCount === 1 &&
      document.isolated.nativeChildRelayReplySettled) &&
    report.nativeGrantDomTriggeredAcceptedCount >= report.documentLoads);
  const first = report.firstDocument.isolated;
  const second = report.secondDocument.isolated;
  assert.equal(first.staleGrantRejected, false);
  assert.equal(report.nativeGrantAcceptedCount,
    Number(first.grantEchoAccepted) + Number(second.grantEchoAccepted));
  assert.equal(report.nativeGrantInvalidRejectedCount,
    Number(first.invalidGrantRejected) + Number(second.invalidGrantRejected));
  assert.equal(report.nativeGrantStaleRejectedCount, Number(second.staleGrantRejected));
  assert.equal(candidate.isolatedGrantEchoObserved,
    first.grantEchoAccepted && second.grantEchoAccepted &&
    report.nativeGrantAcceptedCount === 2);
  assert.equal(candidate.invalidGrantRejected,
    first.invalidGrantRejected && second.invalidGrantRejected &&
    report.nativeGrantInvalidRejectedCount === 2);
  assert.equal(candidate.staleGrantReplayRejected,
    candidate.documentGrantRotated && second.staleGrantRejected &&
    report.nativeGrantStaleRejectedCount === 1);
  assert.equal(candidate.synchronousThrowObserved, report.firstDocument.page.synchronousThrow);
  assert.equal(candidate.callbackByIdOnlyObserved, report.firstDocument.page.callbackByPageId);
  assert.equal(candidate.pageCanForgeResponse, report.firstDocument.page.pageCanForgeDOMReply);
  assert.equal(report.withReplyReturnedPromise,
    report.firstDocument.isolated.nativeReplyPromise);
  assert.equal(report.nativeReplySettled, report.firstDocument.isolated.nativeReplySettled);
  assert.ok(typeof report.environment?.os === 'string' && report.environment.os);
  assert.ok(typeof report.environment?.webkit === 'string' && report.environment.webkit);
  return report;
}
module.exports = { validateM0Evidence };
