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
if (process.argv.length > (simulateTermination ? 3 : 2)) {
  console.error('ELECTRON_MBT_USAGE: build-macos-host.cjs [--simulate-webkit-termination]');
  process.exit(1);
}
const output = path.join(root, 'dist',
  simulateTermination ? 'electron-mbt-native-host-termination-sim' : 'electron-mbt-native-host');
fs.mkdirSync(path.dirname(output), { recursive: true });
const args = [
  '-fobjc-arc', '-fblocks', '-O2', '-Wall', '-Wextra', '-Werror',
  '-mmacosx-version-min=12.0', ...(simulateTermination ? ['-DELECTRON_MBT_TEST_TERMINATION_CALLBACK'] : []),
  source, '-framework', 'AppKit',
  '-framework', 'WebKit', '-o', output,
];
const result = spawnSync(process.env.CC || 'clang', args, {
  stdio: 'inherit', timeout: 120000,
});
if (result.error) console.error(result.error.message);
if (result.status !== 0) process.exit(1);
fs.chmodSync(output, 0o755);
