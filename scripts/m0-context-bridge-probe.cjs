'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { snapshot } = require('../bridges/node/app-files.cjs');
const { validateM0ContextBridgeEvidence } = require('./m0-context-bridge-evidence.cjs');

const root = path.resolve(__dirname, '..');
const oracleRoot = path.join(root, 'fixtures/oracle');
const worldRoot = path.join(root, 'fixtures/worlds');
const baselinePath = path.join(root, 'evidence/electron-baseline.json');
const evidencePath = path.join(root, 'evidence/m0-context-bridge.json');
const manifest = require('../compatibility/manifest.json');

function hashFile(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function printNotRun(reason) {
  console.log(JSON.stringify({ probe: 'm0-context-bridge-spike', status: 'NOT_RUN',
    code: reason, execution: 'NOT_RUN', decision: 'NOT_RUN',
    compatible: false, productionContextBridge: 'NOT_IMPLEMENTED',
    compatibilityGate: 'OPEN' }));
}

if (process.platform !== 'darwin') {
  printNotRun('ELECTRON_MBT_REQUIRES_MACOS');
  process.exit(2);
}
if (process.argv.length > 3 ||
    (process.argv.length === 3 && process.argv[2] !== '--build-only')) {
  console.error('ELECTRON_MBT_M0_CB_USAGE: m0-context-bridge-probe.cjs [--build-only]');
  process.exit(1);
}

const fixtureFiles = {
  checkpoint: path.join(worldRoot, 'm0-cb-checkpoint1.html'),
  oracle: path.join(oracleRoot, 'index.html'),
  negative: path.join(worldRoot, 'm0-cb-negative.html'),
  child: path.join(worldRoot, 'm0-cb-child.html'),
  preload: path.join(oracleRoot, 'preload.cjs'),
  codec: path.join(worldRoot, 'm0-cb-codec.js'),
  pageShim: path.join(worldRoot, 'm0-cb-page-shim.js'),
  isolated: path.join(worldRoot, 'm0-cb-isolated.js'),
};
for (const [name, file] of Object.entries(fixtureFiles)) {
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
    console.error(`ELECTRON_MBT_M0_CB_FIXTURE: missing ${name}`);
    process.exit(1);
  }
}

const beforeOracle = snapshot(oracleRoot).sha256;
const beforeWorlds = snapshot(worldRoot).sha256;
const bundle = path.join(root, 'dist/M0ContextBridgeProbe.app/Contents');
const executable = path.join(bundle, 'MacOS/M0ContextBridgeProbe');
fs.mkdirSync(path.dirname(executable), { recursive: true });
fs.writeFileSync(path.join(bundle, 'Info.plist'), String.raw`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict><key>CFBundleIdentifier</key><string>dev.f4ah6o.electron-mbt.m0-context-bridge-probe</string><key>CFBundleExecutable</key><string>M0ContextBridgeProbe</string><key>CFBundlePackageType</key><string>APPL</string><key>LSMinimumSystemVersion</key><string>13.0</string><key>LSUIElement</key><true/><key>NSHighResolutionCapable</key><true/></dict></plist>`);
const buildArgs = [
  'clang', '-fobjc-arc', '-O2', '-Wall', '-Wextra', '-Werror',
  '-mmacosx-version-min=13.0', '-framework', 'AppKit', '-framework', 'WebKit',
  path.join(root, 'platform/macos/M0ContextBridgeProbe.m'), '-o', executable,
];
const build = spawnSync('xcrun', buildArgs, {
  encoding: 'utf8', timeout: 120000, maxBuffer: 1024 * 1024,
});
if (build.status !== 0) {
  console.error(build.stderr || build.error?.message || 'ELECTRON_MBT_M0_CB_BUILD_FAILED');
  process.exit(1);
}
if (process.argv[2] === '--build-only') {
  console.log(JSON.stringify({ probe: 'm0-context-bridge-spike', status: 'NOT_RUN',
    build: 'PASS', execution: 'NOT_RUN', decision: 'NOT_RUN',
    compatible: false, productionContextBridge: 'NOT_IMPLEMENTED',
    compatibilityGate: 'OPEN' }));
  process.exit(0);
}

const run = spawnSync(executable, [
  fixtureFiles.checkpoint, fixtureFiles.oracle, fixtureFiles.negative,
  fixtureFiles.child, fixtureFiles.preload, fixtureFiles.codec,
  fixtureFiles.pageShim, fixtureFiles.isolated,
], { encoding: 'utf8', timeout: 60000, killSignal: 'SIGKILL', maxBuffer: 4 * 1024 * 1024 });
if (run.status !== 0) {
  console.error(run.stdout || run.stderr || run.error?.message || 'ELECTRON_MBT_M0_CB_PROBE_FAILED');
  process.exit(1);
}
let report;
try {
  const lines = (run.stdout || '').split(/\r?\n/).filter(line => line.trim().startsWith('{'));
  if (lines.length !== 1) throw new Error('probe must emit exactly one JSON result');
  report = JSON.parse(lines[0]);
} catch (error) {
  console.error(`ELECTRON_MBT_M0_CB_RESULT: ${error.message}`);
  process.exit(1);
}
if (report.status !== 'PASS') {
  console.error(JSON.stringify(report));
  process.exit(1);
}

try {
  const afterOracle = snapshot(oracleRoot).sha256;
  const afterWorlds = snapshot(worldRoot).sha256;
  assert.equal(afterOracle, beforeOracle, 'oracle fixture sources changed');
  assert.equal(afterWorlds, beforeWorlds, 'spike fixture sources changed');
  report.sourceHashPreserved = true;

  report.preload = {
    source: 'fixtures/oracle/preload.cjs',
    sha256: hashFile(fixtureFiles.preload),
    bytes: fs.statSync(fixtureFiles.preload).size,
  };
  report.hashes = {
    codec: hashFile(fixtureFiles.codec),
    pageShim: hashFile(fixtureFiles.pageShim),
    isolatedBridge: hashFile(fixtureFiles.isolated),
    checkpointPage: hashFile(fixtureFiles.checkpoint),
    negativePage: hashFile(fixtureFiles.negative),
    child: hashFile(fixtureFiles.child),
  };
  const sdk = spawnSync('xcrun', ['--show-sdk-version'], {
    encoding: 'utf8', timeout: 10000,
  }).stdout?.trim() || 'unknown';
  report.environment = Object.assign({}, report.environment, {
    sdk,
    arch: process.arch,
    node: process.version,
    electronOracle: manifest.versions.electronOracle,
  });

  let baseline = null;
  if (fs.existsSync(baselinePath)) {
    baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
    report.oracleFixture = {
      path: 'fixtures/oracle',
      hash: beforeOracle,
      baselineHash: baseline.fixtureHash,
      match: baseline.fixtureHash === beforeOracle,
    };
    assert.equal(baseline.fixtureHash, beforeOracle, 'oracle fixture hash differs from the baseline');
    const baselineFiles = Array.isArray(baseline.fileHashes) ? baseline.fileHashes : [];
    const preloadEntry = baselineFiles.find(item => item && item.path === 'preload.cjs');
    if (preloadEntry) {
      assert.equal(preloadEntry.sha256, report.preload.sha256,
        'preload source differs from the baseline');
    }
    const baselineObservation = baseline.observed && baseline.observed.observation;
    if (report.decision === 'go') {
      assert.deepEqual(report.observations.oracleFirst, baselineObservation,
        'first oracle observation differs from the pinned baseline');
      assert.deepEqual(report.observations.oracleReload, baselineObservation,
        'reload oracle observation differs from the pinned baseline');
      report.oracleFixture.observationMatch = true;
    } else {
      report.oracleFixture.observationMatch = 'NOT_RUN';
    }
  } else {
    report.oracleFixture = {
      path: 'fixtures/oracle', hash: beforeOracle, baselineHash: null, match: 'NOT_RUN',
    };
  }

  validateM0ContextBridgeEvidence(report);
  fs.mkdirSync(path.dirname(evidencePath), { recursive: true });
  fs.writeFileSync(evidencePath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({
    probe: report.probe, status: report.status, decision: report.decision,
    checkpoint1: report.checkpoint1.result, checkpoint2: report.checkpoint2,
    reportsAccepted: report.native.reportsAccepted,
    staleGrantRejected: report.native.staleGrantRejected,
    oracleFixtureMatch: report.oracleFixture.match,
    sourceHashPreserved: report.sourceHashPreserved,
    out: path.relative(root, evidencePath),
  }));
  if (run.stderr) process.stderr.write(run.stderr);
} catch (error) {
  console.error(error.stack || error.message);
  process.exit(1);
}
