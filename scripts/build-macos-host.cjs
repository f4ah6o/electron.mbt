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
const output = path.join(root, 'dist/electron-mbt-native-host');
fs.mkdirSync(path.dirname(output), { recursive: true });
const args = [
  '-fobjc-arc', '-fblocks', '-O2', '-Wall', '-Wextra', '-Werror',
  '-mmacosx-version-min=12.0', source, '-framework', 'AppKit',
  '-framework', 'WebKit', '-o', output,
];
const result = spawnSync(process.env.CC || 'clang', args, {
  stdio: 'inherit', timeout: 120000,
});
if (result.error) console.error(result.error.message);
if (result.status !== 0) process.exit(1);
fs.chmodSync(output, 0o755);
