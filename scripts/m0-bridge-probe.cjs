'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { snapshot } = require('../bridges/node/app-files.cjs');
const { validateM0Evidence } = require('./m0-bridge-evidence.cjs');

const root = path.resolve(__dirname, '..');
if (process.platform !== 'darwin') {
  console.log(JSON.stringify({ probe: 'm0-isolated-sync-feasibility', status: 'NOT_RUN',
    code: 'ELECTRON_MBT_REQUIRES_MACOS', compatibilityGate: 'OPEN' }));
  process.exit(2);
}
if (process.argv.length > 3 || (process.argv.length === 3 && process.argv[2] !== '--build-only')) {
  console.error('ELECTRON_MBT_M0_USAGE: m0-bridge-probe.cjs [--build-only]');
  process.exit(1);
}
const fixtureRoot = path.join(root, 'fixtures/worlds');
const before = snapshot(fixtureRoot).sha256;
const bundle = path.join(root, 'dist/M0BridgeProbe.app/Contents');
const executable = path.join(bundle, 'MacOS/M0BridgeProbe');
fs.mkdirSync(path.dirname(executable), { recursive: true });
fs.writeFileSync(path.join(bundle, 'Info.plist'), String.raw`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict><key>CFBundleIdentifier</key><string>dev.f4ah6o.electron-mbt.m0-bridge-probe</string><key>CFBundleExecutable</key><string>M0BridgeProbe</string><key>CFBundlePackageType</key><string>APPL</string><key>LSMinimumSystemVersion</key><string>13.0</string><key>LSUIElement</key><true/><key>NSHighResolutionCapable</key><true/></dict></plist>`);
const args = [
  'clang', '-fobjc-arc', '-O2', '-Wall', '-Wextra', '-Werror',
  '-mmacosx-version-min=13.0', '-framework', 'AppKit', '-framework', 'WebKit',
  path.join(root, 'platform/macos/M0BridgeProbe.m'), '-o', executable,
];
const build = spawnSync('xcrun', args, {
  encoding: 'utf8', timeout: 120000, maxBuffer: 1024 * 1024,
});
if (build.status !== 0) {
  console.error(build.stderr || build.error?.message || 'ELECTRON_MBT_M0_BUILD_FAILED');
  process.exit(1);
}
if (process.argv[2] === '--build-only') {
  console.log(JSON.stringify({ probe: 'm0-isolated-sync-feasibility',
    build: 'PASS', execution: 'NOT_RUN', compatibilityGate: 'OPEN' }));
  process.exit(0);
}
const result = spawnSync(executable, [
  path.join(fixtureRoot, 'm0-page.html'), path.join(fixtureRoot, 'm0-preload.js'),
  path.join(fixtureRoot, 'm0-subframe.js'),
], { encoding: 'utf8', timeout: 20000, killSignal: 'SIGKILL', maxBuffer: 1024 * 1024 });
if (result.status !== 0) {
  console.error(result.stdout || result.stderr || result.error?.message || 'ELECTRON_MBT_M0_PROBE_FAILED');
  process.exit(1);
}
let report;
try {
  report = validateM0Evidence(JSON.parse(result.stdout.trim()));
  assert.equal(snapshot(fixtureRoot).sha256, before, 'Fixture sources must remain unchanged');
} catch (error) {
  console.error(error.stack || error.message);
  process.exit(1);
}
report.arch = process.arch;
report.sdk = spawnSync('xcrun', ['--show-sdk-version'], {
  encoding: 'utf8', timeout: 10000,
}).stdout?.trim() || 'unknown';
report.sourceHashPreserved = true;
fs.mkdirSync(path.join(root, 'evidence'), { recursive: true });
fs.writeFileSync(path.join(root, 'evidence/m0-bridge-feasibility.json'),
  JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report));
if (result.stderr) process.stderr.write(result.stderr);
