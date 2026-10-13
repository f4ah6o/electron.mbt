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
  report.arch = process.arch;
  report.sdk = sdk;
  fs.mkdirSync(path.join(root, 'evidence'), { recursive: true });
  fs.writeFileSync(path.join(root, probe.evidence), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report));
  if (result.stderr) process.stderr.write(result.stderr);
}

process.exit(failed ? 1 : 0);
