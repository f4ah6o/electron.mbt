'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');

// Every entry is a standalone feasibility binary that emits one JSON report on
// stdout; its evidence file records what really ran, including NOT_RUN items.
const probes = [
  {
    name: 'wkcontentworld',
    source: 'platform/macos/WKWorldProbe.m',
    app: 'WKWorldProbe',
    bundleId: 'dev.f4ah6o.electron-mbt.world-probe',
    fixture: 'fixtures/worlds/index.html',
    evidence: 'evidence/wkcontentworld.json',
    frameworks: ['AppKit', 'WebKit'],
    timeoutMs: 20000,
  },
  {
    name: 'wksyncbridge',
    source: 'platform/macos/WKSyncBridgeProbe.m',
    app: 'WKSyncBridgeProbe',
    bundleId: 'dev.f4ah6o.electron-mbt.sync-bridge-probe',
    fixture: 'fixtures/worlds/gates.html',
    evidence: 'evidence/wksyncbridge.json',
    frameworks: ['AppKit', 'WebKit'],
    timeoutMs: 60000,
  },
  {
    name: 'wknative',
    source: 'platform/macos/WKNativeProbe.m',
    app: 'WKNativeProbe',
    bundleId: 'dev.f4ah6o.electron-mbt.native-probe',
    fixture: 'fixtures/worlds/gates.html',
    evidence: 'evidence/wknative.json',
    frameworks: ['AppKit', 'WebKit', 'ApplicationServices'],
    timeoutMs: 60000,
    uiElement: false,
  },
];

// The required observation contract for each executed candidate/trace. A
// missing or mistyped field is invalid evidence: it must never be read as an
// "as expected" negative observation or used to support NO_PUBLIC_SYNC_PROXY.
// NOT_RUN and stalled entries are coverage notes only when they carry a reason.
const contracts = {
  wksyncbridge: {
    crossWorldFunctionReference: {
      fields: {
        pageFnVisibleFromIsolated: { types: ['string'], const: 'undefined' },
        isolatedFnVisibleFromPage: { types: ['string'], const: 'undefined' },
      },
    },
    domEventDispatchChannel: {
      fields: {
        isolatedListenerCalls: {
          types: ['array'],
          items: { types: ['object'], fields: { callable: { types: ['boolean'] } } },
        },
        syncRoundTripViaSharedDom: { types: ['boolean'] },
        writeBack: { types: ['string', 'null'] },
        dispatcherCaughtThrow: { types: ['boolean', 'string'] },
      },
      check(observed, at, problems) {
        if (Array.isArray(observed.isolatedListenerCalls)) {
          observed.isolatedListenerCalls.forEach((call, index) => {
            if (call && call.callable === true) {
              problems.push(`${at}.isolatedListenerCalls[${index}].callable is true; a callable payload violates the channel expectation`);
            }
          });
        }
        if (observed.dispatcherCaughtThrow !== false) {
          problems.push(`${at}.dispatcherCaughtThrow is ${JSON.stringify(observed.dispatcherCaughtThrow)}; a propagated throw violates the channel expectation`);
        }
      },
    },
    sharedLocalStorage: {
      fields: {
        pageWrite: { types: ['string', 'null'] },
        isolatedRead: { types: ['string', 'null'] },
      },
    },
    jsDialogChannel: {
      fields: {
        prompt: { types: ['string', 'null'] },
        promptTypeof: { types: ['string'] },
        promptBlockMs: { types: ['number'] },
        latePrompt: { types: ['string', 'null'] },
        confirm: { types: ['boolean', 'null'] },
        confirmBlockMs: { types: ['number'] },
        alert: { types: ['null', 'string'] },
        delegateCalls: { types: ['array'] },
      },
    },
    scriptMessageHandlers: {
      fields: {
        plainReturnType: { types: ['string'] },
        plainIsPromise: { types: ['boolean'] },
        replyReturnType: { types: ['string'] },
        replyIsPromise: { types: ['boolean'] },
        settledSynchronously: { types: ['boolean'] },
        settlementAfterTick: { types: ['string'] },
        pageWorldSeesIsolatedHandler: { types: ['string', 'object'] },
        deliveries: { types: ['array'] },
      },
      check(observed, at, problems) {
        if (observed.plainIsPromise !== true) {
          problems.push(`${at}.plainIsPromise is ${JSON.stringify(observed.plainIsPromise)}, expected true`);
        }
        if (observed.replyIsPromise !== true) {
          problems.push(`${at}.replyIsPromise is ${JSON.stringify(observed.replyIsPromise)}, expected true`);
        }
        if (observed.settledSynchronously !== false) {
          problems.push(`${at}.settledSynchronously is ${JSON.stringify(observed.settledSynchronously)}, expected false`);
        }
      },
    },
    evaluateJavaScriptAsync: {
      fields: {
        value: { types: ['number'], const: 2 },
        completionOnLaterRunLoopTurn: { types: ['boolean'], const: true },
      },
    },
    syncXhrToUrlSchemeHandler: {
      fields: {
        xhr: { types: ['object'] },
        schemeTasks: { types: ['array'] },
      },
      check(observed, at, problems) {
        const xhr = observed.xhr;
        if (!xhr || typeof xhr !== 'object') return;
        if (typeof xhr.response !== 'string' && typeof xhr.error !== 'string') {
          problems.push(`${at}.xhr must record a string response or a string error`);
        }
        if (xhr.blockMs !== undefined && (typeof xhr.blockMs !== 'number' || !Number.isFinite(xhr.blockMs))) {
          problems.push(`${at}.xhr.blockMs is ${JSON.stringify(xhr.blockMs)}, expected a finite number`);
        }
      },
    },
  },
  wknative: {
    windowFocusBlur: {
      fields: {
        afterActivate: { types: ['object'] },
        afterShadowKey: { types: ['object'] },
        domFocusEvent: { types: ['boolean'] },
        domBlurEvent: { types: ['boolean'] },
        native: { types: ['object'] },
        keyNotifications: { types: ['array'] },
      },
      check(observed, at, problems) {
        if (observed.domFocusEvent !== true || observed.domBlurEvent !== true) {
          problems.push(`${at} did not record both DOM focus and blur events`);
        }
      },
    },
    resizeAndDpi: {
      fields: {
        before: { types: ['object'] },
        after: { types: ['object'] },
        windowBackingScaleFactor: { types: ['number'] },
        screenCount: { types: ['number'], integer: true, min: 0 },
      },
      check(observed, at, problems) {
        const before = observed.before;
        const after = observed.after;
        if (!before || !after) return;
        if (!Array.isArray(before.inner) || !Array.isArray(after.inner)) {
          problems.push(`${at}.before.inner and ${at}.after.inner must be arrays`);
          return;
        }
        if (!Number.isInteger(after.resizeEvents) || after.resizeEvents < 1) {
          problems.push(`${at}.after.resizeEvents is ${JSON.stringify(after.resizeEvents)}, expected an integer >= 1`);
        }
        if (JSON.stringify(before.inner) === JSON.stringify(after.inner)) {
          problems.push(`${at} did not record a changed inner viewport`);
        }
      },
    },
    inputDomSynthesis: {
      fields: {
        inputValueAfterSyntheticEvents: { types: ['string'] },
        documentFocused: { types: ['boolean'] },
        events: { types: ['array'] },
        anyTrustedEvent: { types: ['boolean'] },
      },
      check(observed, at, problems) {
        if (observed.anyTrustedEvent !== false) {
          problems.push(`${at}.anyTrustedEvent is ${JSON.stringify(observed.anyTrustedEvent)}, expected false`);
        }
      },
    },
    inputOsEvent: {
      fields: {
        focusState: { types: ['object'] },
        paths: { types: ['object'] },
        inputValue: { types: ['string'] },
        domEvents: { types: ['array'] },
        trustedEventSeen: { types: ['boolean'] },
      },
    },
    osPaste: {
      fields: {
        paths: { types: ['object'] },
        focusState: { types: ['object'] },
        inputValue: { types: ['string', 'null'] },
        pasteEventSeen: { types: ['boolean'] },
        pasteEventTrusted: { types: ['boolean'] },
      },
    },
    pasteboard: {
      fields: {
        native: { types: ['object'] },
        dom: { types: ['object'] },
      },
      check(observed, at, problems) {
        const native = observed.native;
        if (!native || typeof native !== 'object') return;
        if (native.write !== true) {
          problems.push(`${at}.native.write is ${JSON.stringify(native.write)}, expected true`);
        }
        if (native.readBack !== 'mbt-pasteboard-ok') {
          problems.push(`${at}.native.readBack is ${JSON.stringify(native.readBack)}, expected 'mbt-pasteboard-ok'`);
        }
        if (typeof native.pasteboard !== 'string') {
          problems.push(`${at}.native.pasteboard is ${JSON.stringify(native.pasteboard)}, expected a string`);
        }
        const dom = observed.dom;
        if (!dom || typeof dom !== 'object') {
          problems.push(`${at}.dom is missing`);
          return;
        }
        if (dom.stalled === true || dom.skipped === true) {
          if (typeof dom.reason !== 'string' || dom.reason.length === 0) {
            problems.push(`${at}.dom.reason is required when dom.stalled or dom.skipped is true`);
          }
          return;
        }
        if (typeof dom.api !== 'string') {
          problems.push(`${at}.dom must record stalled/skipped evidence or an api type`);
        }
      },
    },
    accessibilityTree: {
      fields: {
        webViewRole: { types: ['string'] },
        childCount: { types: ['number', 'null'], integer: true, min: 0 },
        title: { types: ['string', 'null'] },
      },
    },
  },
};

// Contract each probe's report must satisfy. "probe ran" is not "evidence
// accepted": FAIL/INCONCLUSIVE statuses, missing required entries, unexpected
// outcomes, missing observations, or broken invariants all flag the run.
// NOT_RUN and stalled items are recorded as warnings — they are honest
// coverage data, not failures — but only when they carry a reason.
const schemas = {
  wkcontentworld: {
    statuses: ['PASS', 'FAIL'],
    required: ['isolated', 'page', 'compatibilityGate'],
    invariants: {
      'isolated.domShared': true,
      'isolated.primordialIntact': true,
      'isolated.preloadValue': true,
      'page.handlerHidden': true,
      'page.preloadHidden': true,
    },
  },
  wksyncbridge: {
    statuses: ['PASS', 'PARTIAL', 'INCONCLUSIVE', 'FAIL'],
    required: ['candidates', 'verdict', 'contextBridge', 'compatibilityGate', 'coverage'],
    itemSet: 'candidates',
    itemNames: [
      'crossWorldFunctionReference', 'domEventDispatchChannel', 'sharedLocalStorage',
      'jsDialogChannel', 'scriptMessageHandlers', 'evaluateJavaScriptAsync',
      'syncXhrToUrlSchemeHandler',
    ],
    outcomes: ['as-expected', 'unexpected', 'not-executed'],
    coverageKeys: ['candidates', 'asExpected', 'unexpected', 'notExecuted'],
    contracts: contracts.wksyncbridge,
    entryState(entry) {
      if (entry.status === 'NOT_RUN' || entry.attempted === false || entry.outcome === 'not-executed') {
        return 'not-executed';
      }
      return 'executed';
    },
  },
  wknative: {
    statuses: ['PASS', 'PARTIAL', 'INCONCLUSIVE', 'FAIL'],
    required: ['traces', 'nativeObservations', 'environment', 'coverage'],
    itemSet: 'traces',
    itemNames: [
      'windowFocusBlur', 'resizeAndDpi', 'inputDomSynthesis', 'inputOsEvent', 'osPaste',
      'pasteboard', 'accessibilityTree', 'imeComposition', 'voiceOverTraversal',
      'realKeyboardHardware', 'secondaryDisplayDpi',
    ],
    outcomes: ['as-expected', 'unexpected', 'not-run', 'stalled'],
    coverageKeys: ['executed', 'notRun', 'stalled', 'unexpected'],
    contracts: contracts.wknative,
    entryState(entry) {
      if (entry.status === 'NOT_RUN' || entry.attempted === false || entry.outcome === 'not-run') {
        return 'not-executed';
      }
      if (entry.outcome === 'stalled' || entry.stalled === true) return 'stalled';
      return 'executed';
    },
  },
};

function dig(obj, dotted) {
  return dotted.split('.').reduce((o, key) => (o == null ? undefined : o[key]), obj);
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function valueType(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'number') return Number.isFinite(value) ? 'number' : 'non-finite-number';
  if (typeof value === 'object') return 'object';
  return typeof value;
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.length > 0;
}

// Collect field problems rather than throwing, so one malformed observation
// still reports every other field path and preserves the rest of the evidence.
function collectFieldProblems(value, spec, at, problems) {
  if (value === undefined) {
    problems.push(`${at} is missing`);
    return;
  }
  const actual = valueType(value);
  if (!spec.types.includes(actual)) {
    problems.push(`${at} is ${actual}, expected ${spec.types.join('|')}`);
    return;
  }
  if (spec.const !== undefined && value !== spec.const) {
    problems.push(`${at} is ${JSON.stringify(value)}, expected ${JSON.stringify(spec.const)}`);
  }
  if (spec.equals !== undefined && value !== spec.equals) {
    problems.push(`${at} is ${JSON.stringify(value)}, expected ${JSON.stringify(spec.equals)}`);
  }
  if (actual === 'number' && spec.integer === true && !Number.isInteger(value)) {
    problems.push(`${at} is ${JSON.stringify(value)}, expected an integer`);
  }
  if (actual === 'number' && spec.min !== undefined && value < spec.min) {
    problems.push(`${at} is ${JSON.stringify(value)}, expected >= ${spec.min}`);
  }
  if (spec.items !== undefined && Array.isArray(value)) {
    value.forEach((item, index) => collectFieldProblems(item, spec.items, `${at}[${index}]`, problems));
  }
  if (spec.fields !== undefined && isPlainObject(value)) {
    for (const [key, subSpec] of Object.entries(spec.fields)) {
      collectFieldProblems(value[key], subSpec, `${at}.${key}`, problems);
    }
  }
}

function checkContract(schema, itemName, observed, at, problems) {
  const contract = schema.contracts && schema.contracts[itemName];
  if (!contract) return;
  for (const [key, spec] of Object.entries(contract.fields || {})) {
    collectFieldProblems(observed[key], spec, `${at}.${key}`, problems);
  }
  if (contract.check) contract.check(observed, at, problems);
}

function deriveStatus(schemaName, counts, report) {
  if (counts.unexpected > 0) return 'INCONCLUSIVE';
  if (counts.stalled > 0 || (schemaName === 'wknative' && report.probeStall !== undefined)) return 'PARTIAL';
  if (schemaName === 'wksyncbridge' && counts.notExecuted > 0) return 'PARTIAL';
  return 'PASS';
}

function validateCoverage(report, schemaName, counts, problems) {
  const coverage = report.coverage;
  if (!isPlainObject(coverage)) {
    problems.push(`'coverage' is not an object`);
    return;
  }
  const keys = schemas[schemaName].coverageKeys;
  for (const key of keys) {
    if (!Number.isInteger(coverage[key]) || coverage[key] < 0) {
      problems.push(`coverage.${key} is ${JSON.stringify(coverage[key])}, expected a non-negative integer`);
    } else if (coverage[key] !== counts[key]) {
      problems.push(`coverage.${key} is ${coverage[key]}, computed ${counts[key]} from the recorded entries`);
    }
  }
}

function validateItems(report, schemaName, schema, problems, warnings) {
  const items = report[schema.itemSet];
  if (!isPlainObject(items)) {
    problems.push(`'${schema.itemSet}' is not an object`);
    return null;
  }
  for (const key of Object.keys(items)) {
    if (!schema.itemNames.includes(key)) {
      problems.push(`unknown ${schema.itemSet} entry '${key}'`);
    }
  }
  const counts = schemaName === 'wksyncbridge'
    ? { candidates: schema.itemNames.length, asExpected: 0, unexpected: 0, notExecuted: 0 }
    : { executed: 0, notRun: 0, stalled: 0, unexpected: 0 };
  for (const itemName of schema.itemNames) {
    const entry = items[itemName];
    if (!isPlainObject(entry)) {
      problems.push(`missing ${schema.itemSet} entry '${itemName}'`);
      continue;
    }
    if (entry.observationErrors !== undefined) {
      if (!Array.isArray(entry.observationErrors)) {
        problems.push(`'${itemName}' observationErrors is not an array`);
      } else if (entry.observationErrors.length > 0) {
        problems.push(`'${itemName}' recorded observation errors: ${entry.observationErrors.join(', ')}`);
      }
    }
    const state = schema.entryState(entry);
    if (state === 'not-executed') {
      if (!nonEmptyString(entry.reason)) {
        problems.push(`'${itemName}' is NOT_RUN without a reason`);
      }
      warnings.push(`'${itemName}' NOT_RUN — recorded, not counted as exercised`);
      if (schemaName === 'wksyncbridge') counts.notExecuted += 1;
      else counts.notRun += 1;
      continue;
    }
    if (state === 'stalled') {
      if (!nonEmptyString(entry.reason)) {
        problems.push(`'${itemName}' is stalled without a reason`);
      }
      const stallEvidence = entry.stalled === true ||
        dig(entry, 'observed.dom.stalled') === true ||
        dig(entry, 'observed.stalled') === true;
      if (!stallEvidence) {
        problems.push(`'${itemName}' is stalled without a recorded stall marker`);
      }
      warnings.push(`'${itemName}' stalled — recorded, not counted as exercised`);
      counts.stalled += 1;
      continue;
    }

    if (entry.attempted !== true) {
      problems.push(`'${itemName}' has no attempted flag`);
    }
    if (entry.executed === false) {
      problems.push(`'${itemName}' is executed but records executed:false`);
    }
    const declaredOutcome = entry.outcome;
    if (declaredOutcome === undefined) {
      problems.push(`'${itemName}' is executed without an outcome`);
    } else if (!schema.outcomes.includes(declaredOutcome)) {
      problems.push(`'${itemName}' has unknown outcome '${declaredOutcome}'`);
    } else if (declaredOutcome === 'not-executed' || declaredOutcome === 'not-run' || declaredOutcome === 'stalled') {
      problems.push(`'${itemName}' is executed but claims outcome '${declaredOutcome}'`);
    }
    if (!isPlainObject(entry.observed)) {
      problems.push(`'${itemName}'.observed is ${valueType(entry.observed)}, expected an object`);
    } else {
      checkContract(schema, itemName, entry.observed, `${itemName}.observed`, problems);
      if (itemName === 'pasteboard' && dig(entry, 'observed.dom.skipped') === true) {
        warnings.push(`'${itemName}' DOM clipboard NOT_RUN — explicit opt-in was not set`);
      }
    }
    if (declaredOutcome === 'unexpected') {
      problems.push(`'${itemName}' outcome is unexpected — review the recorded evidence`);
      counts.unexpected += 1;
    } else if (declaredOutcome === 'as-expected') {
      if (schemaName === 'wksyncbridge') counts.asExpected += 1;
      else counts.executed += 1;
    }
  }
  if (schemaName === 'wksyncbridge') {
    if (report.status === 'PASS' && counts.unexpected > 0) {
      problems.push(`status PASS but ${counts.unexpected} ${schema.itemSet} entr(y/ies) are unexpected`);
    }
  } else if (report.status === 'PASS' && counts.unexpected > 0) {
    problems.push(`status PASS but ${counts.unexpected} ${schema.itemSet} entr(y/ies) are unexpected`);
  }
  return counts;
}

// Returns { problems, warnings }; problems flag the run, warnings are honest
// coverage notes (NOT_RUN / stalled) that never count as acceptance evidence.
function validateReport(probeName, report) {
  const problems = [];
  const warnings = [];
  const schema = schemas[probeName];
  if (!schema) {
    return { problems: [`no validation schema registered for probe '${probeName}'`], warnings };
  }
  if (!report || typeof report !== 'object' || Array.isArray(report)) {
    return { problems: ['report is not a JSON object'], warnings };
  }
  if (report.probe !== probeName) {
    problems.push(`report.probe is '${report.probe}', expected '${probeName}'`);
  }
  if (!schema.statuses.includes(report.status)) {
    problems.push(`report.status is '${report.status}', expected one of ${schema.statuses.join('/')}`);
  }
  if (report.status === 'FAIL') {
    problems.push(`probe reported FAIL (${report.code || 'no code'})`);
  }
  if (report.status === 'INCONCLUSIVE') {
    problems.push('probe reported INCONCLUSIVE — observations violated expectations; review the evidence');
  }
  for (const key of schema.required) {
    if (!Object.prototype.hasOwnProperty.call(report, key)) problems.push(`missing required key '${key}'`);
  }
  if (report.nativeObservations !== undefined && !Array.isArray(report.nativeObservations)) {
    problems.push(`'nativeObservations' is not an array`);
  }
  if (report.environment !== undefined && !isPlainObject(report.environment)) {
    problems.push(`'environment' is not an object`);
  }
  if (report.compatibilityGate !== undefined && !nonEmptyString(report.compatibilityGate)) {
    problems.push(`'compatibilityGate' is not a non-empty string`);
  }
  if (report.verdict !== undefined && !nonEmptyString(report.verdict)) {
    problems.push(`'verdict' is not a non-empty string`);
  }
  if (report.contextBridge !== undefined && !nonEmptyString(report.contextBridge)) {
    problems.push(`'contextBridge' is not a non-empty string`);
  }
  for (const [dotted, expected] of Object.entries(schema.invariants || {})) {
    const actual = dig(report, dotted);
    if (actual !== expected) {
      problems.push(`invariant ${dotted} is ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
    }
  }
  if (schema.itemSet) {
    const counts = validateItems(report, probeName, schema, problems, warnings);
    if (counts) {
      validateCoverage(report, probeName, counts, problems);
      const derived = deriveStatus(probeName, counts, report);
      if (['PASS', 'PARTIAL', 'INCONCLUSIVE'].includes(report.status) && report.status !== derived) {
        problems.push(`status ${report.status} is inconsistent with the recorded observations (expected ${derived})`);
      }
    }
  }
  return { problems, warnings };
}

function main() {
  if (process.platform !== 'darwin') {
    console.log(JSON.stringify({ probe: 'macos-probe', status: 'NOT_RUN', code: 'ELECTRON_MBT_REQUIRES_MACOS', planned: probes.map((p) => p.name) }));
    process.exit(2);
  }

  const buildOnly = process.argv[2] === '--build-only';
  const sdk = spawnSync('xcrun', ['--show-sdk-version'], { encoding: 'utf8', timeout: 10000 }).stdout?.trim() || 'unknown';
  let failed = false;

  for (const probe of probes) {
    const bundle = path.join(root, `dist/${probe.app}.app/Contents`);
    const executable = path.join(bundle, `MacOS/${probe.app}`);
    fs.mkdirSync(path.dirname(executable), { recursive: true });
    fs.writeFileSync(path.join(bundle, 'Info.plist'), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict><key>CFBundleIdentifier</key><string>${probe.bundleId}</string><key>CFBundleExecutable</key><string>${probe.app}</string><key>CFBundlePackageType</key><string>APPL</string><key>LSMinimumSystemVersion</key><string>13.0</string><key>LSUIElement</key><${probe.uiElement === false ? 'false' : 'true'}/><key>NSHighResolutionCapable</key><true/></dict></plist>`);
    const clang = ['clang', '-fobjc-arc', '-O2', '-Wall', '-Wextra', '-Werror', '-mmacosx-version-min=13.0'];
    for (const framework of probe.frameworks) clang.push('-framework', framework);
    clang.push(path.join(root, probe.source), '-o', executable);
    const build = spawnSync('xcrun', clang, { encoding: 'utf8', timeout: 120000, maxBuffer: 1024 * 1024 });
    if (build.status !== 0) {
      console.error(`[${probe.name}] build failed:\n${build.stderr || build.error?.message}`);
      failed = true;
      continue;
    }
    if (buildOnly) {
      console.log(JSON.stringify({ probe: probe.name, build: 'PASS', execution: 'NOT_RUN', arch: process.arch }));
      continue;
    }
    // The executable is a bounded diagnostic, not the application's normal launch path.
    const result = spawnSync(executable, [path.join(root, probe.fixture)], { encoding: 'utf8', timeout: probe.timeoutMs, killSignal: 'SIGKILL', maxBuffer: 1024 * 1024 });
    let report;
    if (result.status === 0) {
      try {
        report = JSON.parse(result.stdout);
      } catch (error) {
        report = { probe: probe.name, status: 'FAIL', code: 'ELECTRON_MBT_PROBE_REPORT_PARSE', output: result.stdout.trim() };
        failed = true;
      }
    } else {
      report = { probe: probe.name, status: 'FAIL', code: result.error?.code || 'ELECTRON_MBT_NATIVE_PROBE', output: result.stdout.trim() };
      failed = true;
    }
    const validation = validateReport(probe.name, report);
    report.validation = validation;
    for (const problem of validation.problems) {
      console.error(`[${probe.name}] INVALID: ${problem}`);
      failed = true;
    }
    for (const warning of validation.warnings) {
      console.error(`[${probe.name}] note: ${warning}`);
    }
    report.arch = process.arch;
    report.sdk = sdk;
    fs.mkdirSync(path.join(root, 'evidence'), { recursive: true });
    fs.writeFileSync(path.join(root, probe.evidence), `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify(report));
    if (result.stderr) process.stderr.write(result.stderr);
  }

  process.exit(failed ? 1 : 0);
}

if (require.main === module) {
  main();
}

module.exports = { validateReport, schemas, probes, contracts };
