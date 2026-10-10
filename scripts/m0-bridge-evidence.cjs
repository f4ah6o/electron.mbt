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
  assert.equal(typeof report.withReplyReturnedPromise, 'boolean');
  assert.equal(typeof report.nativeReplySettled, 'boolean');
  assert.equal(typeof report.newDocumentScriptReinitialized, 'boolean');
  for (const document of [report.firstDocument, report.secondDocument]) {
    assert.equal(document?.page?.firstScriptAttempted, true);
    assert.equal(document.page.privateGlobalHidden, true);
    assert.equal(document.page.nativeReplyHandlerHidden, true);
    assert.equal(document.isolated?.isolatedMarker, true);
    assert.equal(document.isolated.primordialIntact, true);
    assert.ok(Number.isSafeInteger(document.isolated.requests));
    assert.ok(document.isolated.requests >= 0);
    assert.ok(Number.isSafeInteger(document.isolated.callbackAttempts));
    assert.ok(document.isolated.callbackAttempts >= 0);
    assert.ok(Number.isSafeInteger(document.isolated.nativePageRequestCount));
    assert.ok(document.isolated.nativePageRequestCount >= 0);
    assert.equal(typeof document.isolated.nativePageReplySettled, 'boolean');
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
  assert.equal(candidate?.pageInitiatorAuthenticated, false);
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
    report.pageInducedNativeMessageCount === 2);
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
