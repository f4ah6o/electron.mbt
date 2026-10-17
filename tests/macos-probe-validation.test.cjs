'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { validateReport } = require('../scripts/macos-probe.cjs');

const syncObserved = {
  crossWorldFunctionReference: {
    pageFnVisibleFromIsolated: 'undefined',
    isolatedFnVisibleFromPage: 'undefined',
  },
  domEventDispatchChannel: {
    isolatedListenerCalls: [
      { detailType: 'string', callable: false, at: 1, preview: 'call-1', detailTag: null },
      { detailType: 'object', callable: false, at: 2, preview: null, detailTag: 'obj-payload' },
    ],
    syncRoundTripViaSharedDom: true,
    writeBack: 'handled:call-1',
    dispatcherCaughtThrow: false,
  },
  sharedLocalStorage: { pageWrite: 'ok', isolatedRead: 'page-write' },
  jsDialogChannel: {
    prompt: null,
    promptTypeof: 'function',
    promptBlockMs: 0,
    latePrompt: null,
    confirm: true,
    confirmBlockMs: 0,
    alert: null,
    delegateCalls: [{ kind: 'dialog.confirm', mainFrame: true }],
  },
  scriptMessageHandlers: {
    plainReturnType: 'undefined',
    plainIsPromise: true,
    replyReturnType: 'object',
    replyIsPromise: true,
    settledSynchronously: false,
    settlementAfterTick: 'resolved:native-reply-value',
    pageWorldSeesIsolatedHandler: 'no-webkit',
    deliveries: [{ kind: 'scriptMessage.plain', mainFrame: true }],
  },
  evaluateJavaScriptAsync: { value: 2, completionOnLaterRunLoopTurn: true },
  syncXhrToUrlSchemeHandler: {
    xhr: { blockMs: 1, status: 200, response: 'scheme-payload' },
    schemeTasks: [{ kind: 'scheme.fulfillInline' }],
  },
};

const nativeObserved = {
  windowFocusBlur: {
    attempted: true, executed: true, outcome: 'as-expected',
    observed: {
      afterActivate: { trace: [{ kind: 'window.focus' }], hasFocus: true },
      afterShadowKey: { trace: [{ kind: 'window.blur' }], hasFocus: false },
      domFocusEvent: true,
      domBlurEvent: true,
      native: { appActive: true, windowKey: true, activateInvoked: true },
      keyNotifications: [{ kind: 'window.becameKey' }],
    },
  },
  resizeAndDpi: {
    attempted: true, executed: true, outcome: 'as-expected',
    observed: {
      before: { dpr: 1, inner: [640, 480], screen: { w: 1920, h: 1080, avail: [1920, 1080] }, visualViewport: [640, 480], mqlMatches: false },
      after: { dpr: 1, inner: [800, 600], screen: { w: 1920, h: 1080, avail: [1920, 1080] }, visualViewport: [800, 600], mqlMatches: false, resizeEvents: 1, dpiChanged: false },
      windowBackingScaleFactor: 1,
      screenCount: 1,
    },
  },
  inputDomSynthesis: {
    attempted: true, executed: true, outcome: 'as-expected',
    observed: { inputValueAfterSyntheticEvents: '', documentFocused: true, events: [], anyTrustedEvent: false },
  },
  inputOsEvent: {
    attempted: true, executed: true, outcome: 'as-expected',
    observed: {
      focusState: { focused: 'probe-input', hasFocus: true },
      paths: { cgEventPosted: true, cgEventDelivered: true, nsEventPosted: true, nsEventDelivered: true },
      inputValue: 'ab',
      domEvents: [],
      trustedEventSeen: true,
    },
  },
  osPaste: {
    attempted: true, executed: false, status: 'NOT_RUN',
    reason: 'posting Cmd+V would mutate the general pasteboard; opt-in is required',
  },
  pasteboard: {
    attempted: true, executed: true, outcome: 'as-expected',
    observed: {
      native: {
        pasteboard: 'named:electron-mbt-probe',
        write: true,
        readBack: 'mbt-pasteboard-ok',
        generalPasteboardVerify: 'skipped: reading the general pasteboard requires ELECTRON_MBT_OS_PASTE_OPT_IN=1',
      },
      dom: { skipped: true, reason: 'DOM clipboard requires explicit opt-in', api: 'object' },
    },
  },
  accessibilityTree: {
    attempted: true, executed: true, outcome: 'as-expected',
    observed: { webViewRole: 'AXWebArea', childCount: 1, title: 'electron.mbt native gate probe' },
  },
  imeComposition: { attempted: false, status: 'NOT_RUN', reason: 'real IME composition is not driveable from this probe' },
  voiceOverTraversal: { attempted: false, status: 'NOT_RUN', reason: 'VoiceOver cannot be enabled from this process' },
  realKeyboardHardware: { attempted: false, status: 'NOT_RUN', reason: 'no operator pressed real keys' },
  secondaryDisplayDpi: { attempted: false, status: 'NOT_RUN', reason: 'only one display is attached' },
};

function baseSyncReport() {
  const candidates = {};
  for (const [name, observed] of Object.entries(syncObserved)) {
    candidates[name] = {
      attempted: true, executed: true, synchronousChannel: false,
      contextBridgeCompatible: false, outcome: 'as-expected',
      expectation: 'recorded observation', observed: structuredClone(observed),
    };
  }
  return {
    probe: 'wksyncbridge',
    status: 'PASS',
    compatibilityGate: 'OPEN',
    contextBridge: 'NO_PUBLIC_SYNC_PROXY',
    verdict: 'NO_PUBLIC_SYNC_PROXY',
    coverage: { candidates: 7, asExpected: 7, unexpected: 0, notExecuted: 0 },
    nativeObservations: [],
    candidates,
  };
}

function baseNativeReport() {
  const traces = {};
  for (const [name, entry] of Object.entries(nativeObserved)) {
    traces[name] = structuredClone(entry);
  }
  return {
    probe: 'wknative', status: 'PASS', compatibilityGate: 'OPEN',
    coverage: { executed: 6, notRun: 5, stalled: 0, unexpected: 0 },
    traces, nativeObservations: [], environment: {},
  };
}

function deletePath(root, dotted) {
  const parts = dotted.split('.');
  let target = root;
  for (const key of parts.slice(0, -1)) target = target[key];
  delete target[parts[parts.length - 1]];
}

test('macos-probe validation accepts a clean wksyncbridge PASS', () => {
  const { problems } = validateReport('wksyncbridge', baseSyncReport());
  assert.deepEqual(problems, []);
});

test('macos-probe validation flags a FAIL status report', () => {
  const report = baseSyncReport();
  report.status = 'FAIL';
  report.code = 'ELECTRON_MBT_X';
  assert.ok(validateReport('wksyncbridge', report).problems.length > 0);
});

test('macos-probe validation flags INCONCLUSIVE', () => {
  const report = baseSyncReport();
  report.status = 'INCONCLUSIVE';
  assert.ok(validateReport('wksyncbridge', report).problems.some((p) => p.includes('INCONCLUSIVE')));
});

test('macos-probe validation flags a missing required candidate', () => {
  const report = baseSyncReport();
  delete report.candidates.syncXhrToUrlSchemeHandler;
  assert.ok(validateReport('wksyncbridge', report).problems.some((p) => p.includes('syncXhrToUrlSchemeHandler')));
});

test('macos-probe validation flags an unexpected candidate outcome', () => {
  const report = baseSyncReport();
  report.candidates.crossWorldFunctionReference.outcome = 'unexpected';
  assert.ok(validateReport('wksyncbridge', report).problems.some((p) => p.includes('crossWorldFunctionReference')));
});

test('macos-probe validation flags PASS status with an unexpected entry (incoherence)', () => {
  const report = baseSyncReport();
  report.status = 'PASS';
  report.candidates.jsDialogChannel.outcome = 'unexpected';
  assert.ok(validateReport('wksyncbridge', report).problems.length >= 2);
});

test('macos-probe validation separates NOT_RUN items as warnings, not problems', () => {
  const { problems, warnings } = validateReport('wknative', baseNativeReport());
  assert.deepEqual(problems, []);
  assert.ok(warnings.length >= 5);
  assert.ok(warnings.some((w) => w.includes('DOM clipboard NOT_RUN')));
});

test('macos-probe validation records a stalled trace as warning with PARTIAL status ok', () => {
  const report = baseNativeReport();
  report.status = 'PARTIAL';
  report.coverage = { executed: 5, notRun: 5, stalled: 1, unexpected: 0 };
  report.traces.pasteboard = {
    attempted: true, executed: true, outcome: 'stalled',
    reason: 'evaluateJavaScript never completed',
    observed: {
      native: { pasteboard: 'named:electron-mbt-probe', write: true, readBack: 'mbt-pasteboard-ok', generalPasteboardVerify: 'skipped' },
      dom: { stalled: true, reason: 'evaluateJavaScript never completed' },
    },
  };
  const { problems, warnings } = validateReport('wknative', report);
  assert.deepEqual(problems, []);
  assert.ok(warnings.some((w) => w.includes('pasteboard')));
});

test('macos-probe validation flags a broken wkcontentworld invariant', () => {
  const report = {
    probe: 'wkcontentworld', status: 'PASS', compatibilityGate: 'OPEN',
    isolated: { domShared: true, primordialIntact: false, preloadValue: true },
    page: { handlerHidden: true, preloadHidden: true },
  };
  assert.ok(validateReport('wkcontentworld', report).problems.some((p) => p.includes('primordialIntact')));
});

test('macos-probe validation flags missing wknative traces and required keys', () => {
  const report = baseNativeReport();
  delete report.traces.inputOsEvent;
  delete report.coverage;
  const { problems } = validateReport('wknative', report);
  assert.ok(problems.some((p) => p.includes('inputOsEvent')));
  assert.ok(problems.some((p) => p.includes('coverage')));
});

test('the 0005 missing-observation reproducer is rejected for every candidate', () => {
  const report = baseSyncReport();
  for (const name of Object.keys(report.candidates)) report.candidates[name].observed = {};
  const { problems } = validateReport('wksyncbridge', report);
  for (const name of Object.keys(report.candidates)) {
    assert.ok(problems.some((p) => p.startsWith(`${name}.observed`)), `${name} was not rejected: ${problems.join(' | ')}`);
  }
});

for (const [candidate, field] of [
  ['crossWorldFunctionReference', 'observed.pageFnVisibleFromIsolated'],
  ['domEventDispatchChannel', 'observed.isolatedListenerCalls'],
  ['sharedLocalStorage', 'observed.pageWrite'],
  ['jsDialogChannel', 'observed.promptTypeof'],
  ['scriptMessageHandlers', 'observed.settledSynchronously'],
  ['evaluateJavaScriptAsync', 'observed.value'],
  ['syncXhrToUrlSchemeHandler', 'observed.xhr'],
]) {
  test(`a wksyncbridge candidate with missing ${field} is invalid`, () => {
    const report = baseSyncReport();
    deletePath(report.candidates[candidate], field);
    const { problems } = validateReport('wksyncbridge', report);
    assert.ok(problems.some((p) => p.startsWith(`${candidate}.${field}`)), problems.join(' | '));
  });
}

for (const [trace, field] of [
  ['windowFocusBlur', 'observed.afterActivate'],
  ['resizeAndDpi', 'observed.after'],
  ['inputDomSynthesis', 'observed.inputValueAfterSyntheticEvents'],
  ['inputOsEvent', 'observed.paths'],
  ['pasteboard', 'observed.native'],
  ['accessibilityTree', 'observed.webViewRole'],
]) {
  test(`a wknative trace with missing ${field} is invalid`, () => {
    const report = baseNativeReport();
    deletePath(report.traces[trace], field);
    const { problems } = validateReport('wknative', report);
    assert.ok(problems.some((p) => p.startsWith(`${trace}.${field}`)), problems.join(' | '));
  });
}

test('null and wrong-typed observations are rejected with a field path', () => {
  const report = baseSyncReport();
  report.candidates.crossWorldFunctionReference.observed.pageFnVisibleFromIsolated = null;
  report.candidates.evaluateJavaScriptAsync.observed.completionOnLaterRunLoopTurn = 'yes';
  report.candidates.domEventDispatchChannel.observed.isolatedListenerCalls = {};
  const { problems } = validateReport('wksyncbridge', report);
  assert.ok(problems.some((p) => p.includes('pageFnVisibleFromIsolated')));
  assert.ok(problems.some((p) => p.includes('completionOnLaterRunLoopTurn')));
  assert.ok(problems.some((p) => p.includes('isolatedListenerCalls')));
});

test('self-reported coverage cannot hide missing or unexecuted entries', () => {
  const report = baseSyncReport();
  report.coverage.asExpected = 6;
  assert.ok(validateReport('wksyncbridge', report).problems.some((p) => p.includes('coverage.asExpected')));
  const native = baseNativeReport();
  native.coverage.executed = 7;
  assert.ok(validateReport('wknative', native).problems.some((p) => p.includes('coverage.executed')));
});

test('unknown entries and missing NOT_RUN reasons are rejected', () => {
  const sync = baseSyncReport();
  sync.candidates.inventedChannel = structuredClone(sync.candidates.jsDialogChannel);
  assert.ok(validateReport('wksyncbridge', sync).problems.some((p) => p.includes('inventedChannel')));
  const native = baseNativeReport();
  delete native.traces.imeComposition.reason;
  assert.ok(validateReport('wknative', native).problems.some((p) => p.includes('imeComposition') && p.includes('reason')));
});

test('a stalled trace without a marker or reason is rejected', () => {
  const report = baseNativeReport();
  report.status = 'PARTIAL';
  report.traces.pasteboard = {
    attempted: true, executed: true, outcome: 'stalled',
    observed: { native: report.traces.pasteboard.observed.native, dom: { api: 'object' } },
  };
  const { problems } = validateReport('wknative', report);
  assert.ok(problems.some((p) => p.includes('stalled without a reason')));
  assert.ok(problems.some((p) => p.includes('stalled without a recorded stall marker')));
});

test('malformed pasteboard and sync XHR observations fail closed', () => {
  const native = baseNativeReport();
  native.traces.pasteboard.observed.dom = null;
  assert.ok(validateReport('wknative', native).problems.some((p) => p.includes('pasteboard.observed.dom')));
  const sync = baseSyncReport();
  sync.candidates.syncXhrToUrlSchemeHandler.observed.xhr = null;
  assert.ok(validateReport('wksyncbridge', sync).problems.some((p) => p.includes('syncXhrToUrlSchemeHandler.observed.xhr')));
});

test('status cannot be PARTIAL when every wksyncbridge candidate executed', () => {
  const report = baseSyncReport();
  report.status = 'PARTIAL';
  assert.ok(validateReport('wksyncbridge', report).problems.some((p) => p.includes('inconsistent')));
});


test('producer-recorded observation errors invalidate an otherwise expected candidate', () => {
  const report = baseSyncReport();
  report.candidates.jsDialogChannel.observationErrors = ['observed.promptTypeof'];
  assert.ok(validateReport('wksyncbridge', report).problems.some((p) => p.includes('recorded observation errors')));
});

test('a missing observed object is rejected rather than treated as an empty measurement', () => {
  const report = baseSyncReport();
  delete report.candidates.evaluateJavaScriptAsync.observed;
  assert.ok(validateReport('wksyncbridge', report).problems.some((p) => p.includes("evaluateJavaScriptAsync'.observed")));
});
