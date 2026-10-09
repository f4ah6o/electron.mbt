'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
if (process.platform !== 'darwin') {
  console.log(JSON.stringify({ probe: 'wkcontentworld', status: 'NOT_RUN', code: 'ELECTRON_MBT_REQUIRES_MACOS' }));
  process.exit(2);
}
const bundle = path.join(root, 'dist/WKWorldProbe.app/Contents');
const executable = path.join(bundle, 'MacOS/WKWorldProbe');
fs.mkdirSync(path.dirname(executable), { recursive: true });
fs.writeFileSync(path.join(bundle, 'Info.plist'), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict><key>CFBundleIdentifier</key><string>dev.f4ah6o.electron-mbt.world-probe</string><key>CFBundleExecutable</key><string>WKWorldProbe</string><key>CFBundlePackageType</key><string>APPL</string><key>LSMinimumSystemVersion</key><string>13.0</string><key>LSUIElement</key><true/><key>NSHighResolutionCapable</key><true/></dict></plist>`);
const build = spawnSync('xcrun', ['clang', '-fobjc-arc', '-O2', '-Wall', '-Wextra', '-Werror', '-mmacosx-version-min=13.0', '-framework', 'AppKit', '-framework', 'WebKit', path.join(root, 'platform/macos/WKWorldProbe.m'), '-o', executable], { encoding: 'utf8', timeout: 120000, maxBuffer: 1024 * 1024 });
if (build.status !== 0) { console.error(build.stderr || build.error?.message); process.exit(1); }
if (process.argv[2] === '--build-only') { console.log(JSON.stringify({ build: 'PASS', execution: 'NOT_RUN', arch: process.arch })); process.exit(0); }
// The executable is a bounded diagnostic, not the application's normal launch path.
const result = spawnSync(executable, [path.join(root, 'fixtures/worlds/index.html')], { encoding: 'utf8', timeout: 20000, killSignal: 'SIGKILL', maxBuffer: 1024 * 1024 });
const report = result.status === 0 ? JSON.parse(result.stdout) : { probe: 'wkcontentworld', status: 'FAIL', code: result.error?.code || 'ELECTRON_MBT_NATIVE_PROBE', output: result.stdout.trim() };
report.arch = process.arch;
report.sdk = spawnSync('xcrun', ['--show-sdk-version'], { encoding: 'utf8', timeout: 10000 }).stdout?.trim() || 'unknown';
fs.mkdirSync(path.join(root, 'evidence'), { recursive: true });
fs.writeFileSync(path.join(root, 'evidence/wkcontentworld.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report));
if (result.stderr) process.stderr.write(result.stderr);
process.exit(result.status === 0 ? 0 : 1);
