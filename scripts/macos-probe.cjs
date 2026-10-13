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

// Contract each probe's report must satisfy. "probe ran" is not "evidence
// accepted": FAIL/INCONCLUSIVE statuses, missing required entries, unexpected
// outcomes, or broken invariants all flag the run. NOT_RUN and stalled items
// are recorded as warnings — they are honest coverage data, not failures.
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
  },
};

function dig(obj, dotted) {
  return dotted.split('.').reduce((o, key) => (o == null ? undefined : o[key]), obj);
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
  if (!report || typeof report !== 'object') {
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
    if (report[key] === undefined) problems.push(`missing required key '${key}'`);
  }
  for (const [dotted, expected] of Object.entries(schema.invariants || {})) {
    const actual = dig(report, dotted);
    if (actual !== expected) {
      problems.push(`invariant ${dotted} is ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
    }
  }
  if (schema.itemSet) {
    const items = report[schema.itemSet];
    if (items == null || typeof items !== 'object') {
      problems.push(`'${schema.itemSet}' is not an object`);
    } else {
      for (const itemName of schema.itemNames) {
        const entry = items[itemName];
        if (!entry) {
          problems.push(`missing ${schema.itemSet} entry '${itemName}'`);
          continue;
        }
        if (entry.attempted === undefined) {
          problems.push(`'${itemName}' has no attempted flag`);
        }
        const outcome = entry.outcome;
        if (outcome === 'unexpected') {
          problems.push(`'${itemName}' outcome is unexpected — review the recorded evidence`);
        } else if (outcome === 'stalled' || entry.stalled === true || dig(entry, 'observed.dom.stalled') === true) {
          warnings.push(`'${itemName}' stalled — recorded, not counted as exercised`);
        } else if (outcome === 'not-run' || outcome === 'not-executed' || entry.status === 'NOT_RUN' || entry.executed === false) {
          warnings.push(`'${itemName}' NOT_RUN — recorded, not counted as exercised`);
        } else if (outcome !== undefined && !schema.outcomes.includes(outcome)) {
          problems.push(`'${itemName}' has unknown outcome '${outcome}'`);
        }
      }
      // A PASS verdict with unexpected entries is incoherent by definition.
      const unexpectedCount = schema.itemNames.filter((n) => items[n] && items[n].outcome === 'unexpected').length;
      if (report.status === 'PASS' && unexpectedCount > 0) {
        problems.push(`status PASS but ${unexpectedCount} ${schema.itemSet} entr(y/ies) are unexpected`);
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

module.exports = { validateReport, schemas, probes };
