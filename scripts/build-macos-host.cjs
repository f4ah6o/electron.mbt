'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

if (process.platform !== 'darwin') {
  console.error('ELECTRON_MBT_UNSUPPORTED_PLATFORM: native AppKit host requires macOS');
  process.exit(1);
}
const root = path.resolve(__dirname, '..');
const source = path.join(root, 'platform/macos/NativeHost.m');
const simulateTermination = process.argv.length === 3 &&
  process.argv[2] === '--simulate-webkit-termination';
const simulateNativeClose = process.argv.length === 3 &&
  process.argv[2] === '--simulate-native-close';
const killRealWebKitProcess = process.argv.length === 3 &&
  process.argv[2] === '--kill-real-webkit-process';
const simulateStaleNavigationCallback = process.argv.length === 3 &&
  process.argv[2] === '--simulate-stale-navigation-callback';
const simulateMainDialogCancel = process.argv.length === 3 &&
  process.argv[2] === '--simulate-main-dialog-cancel';
if (process.argv.length > 3 ||
    (process.argv.length === 3 && !simulateTermination && !simulateNativeClose &&
     !killRealWebKitProcess && !simulateStaleNavigationCallback &&
     !simulateMainDialogCancel)) {
  console.error('ELECTRON_MBT_USAGE: build-macos-host.cjs [--simulate-webkit-termination|--simulate-native-close|--kill-real-webkit-process|--simulate-stale-navigation-callback|--simulate-main-dialog-cancel]');
  process.exit(1);
}
const output = path.join(root, 'dist',
  simulateTermination ? 'emoon-host-termination-sim' :
  simulateNativeClose ? 'emoon-host-close-sim' :
  killRealWebKitProcess ? 'emoon-host-webkit-kill-test' :
  simulateStaleNavigationCallback ? 'emoon-host-stale-navigation-test' :
  simulateMainDialogCancel ? 'emoon-host-main-dialog-cancel-sim' :
  'emoon-host');
fs.mkdirSync(path.dirname(output), { recursive: true });
const args = [
  '-fobjc-arc', '-fblocks', '-O2', '-Wall', '-Wextra', '-Werror',
  '-mmacosx-version-min=12.0',
  ...(simulateTermination ? ['-DELECTRON_MBT_TEST_TERMINATION_CALLBACK'] : []),
  ...(simulateNativeClose ? ['-DELECTRON_MBT_TEST_NATIVE_CLOSE'] : []),
  ...(killRealWebKitProcess ? ['-DELECTRON_MBT_TEST_REAL_WEBKIT_KILL'] : []),
  ...(simulateStaleNavigationCallback ? ['-DELECTRON_MBT_TEST_STALE_NAVIGATION_CALLBACK'] : []),
  ...(simulateMainDialogCancel ? ['-DELECTRON_MBT_TEST_MAIN_DIALOG_CANCEL'] : []),
  source, '-framework', 'AppKit',
  '-framework', 'WebKit', '-framework', 'UniformTypeIdentifiers', '-o', output,
];
const result = spawnSync(process.env.CC || 'clang', args, {
  stdio: 'inherit', timeout: 120000,
});
if (result.error) console.error(result.error.message);
if (result.status !== 0) process.exit(1);
fs.chmodSync(output, 0o755);
