'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { validateReport } = require('../scripts/macos-probe.cjs');

function baseSyncReport() {
  return {
    probe: 'wksyncbridge',
    status: 'PASS',
    compatibilityGate: 'OPEN',
    contextBridge: 'NO_PUBLIC_SYNC_PROXY',
    verdict: '…',
    coverage: { candidates: 7, asExpected: 7, unexpected: 0, notExecuted: 0 },
    candidates: Object.fromEntries([
      'crossWorldFunctionReference', 'domEventDispatchChannel', 'sharedLocalStorage',
      'jsDialogChannel', 'scriptMessageHandlers', 'evaluateJavaScriptAsync',
      'syncXhrToUrlSchemeHandler',
    ].map((n) => [n, {
      attempted: true, executed: true, synchronousChannel: false,
      contextBridgeCompatible: false, outcome: 'as-expected',
      expectation: 'x', observed: {},
    }])),
  };
}

function baseNativeReport() {
  const traces = {};
  for (const n of ['windowFocusBlur', 'osPaste', 'imeComposition', 'voiceOverTraversal',
    'realKeyboardHardware', 'secondaryDisplayDpi']) {
    traces[n] = { attempted: false, status: 'NOT_RUN', reason: 'x', outcome: 'not-run' };
  }
  for (const n of ['resizeAndDpi', 'inputDomSynthesis', 'inputOsEvent', 'accessibilityTree']) {
    traces[n] = { attempted: true, executed: true, outcome: 'as-expected', observed: {} };
  }
  traces.pasteboard = { attempted: true, executed: true, outcome: 'as-expected', observed: {} };
  return {
    probe: 'wknative', status: 'PASS', compatibilityGate: 'OPEN',
    coverage: { executed: 5, notRun: 6, stalled: 0, unexpected: 0 },
    traces, nativeObservations: [], environment: {},
  };
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
  assert.ok(warnings.length >= 6);
});

test('macos-probe validation records a stalled trace as warning with PARTIAL status ok', () => {
  const report = baseNativeReport();
  report.status = 'PARTIAL';
  report.traces.pasteboard = { attempted: true, executed: true, outcome: 'stalled', observed: { dom: { stalled: true } } };
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
