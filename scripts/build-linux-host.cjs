'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const output = path.join(root, 'dist/emoon-host');
const sources = [
  path.join(root, 'platform/linux/NativeHost.c'),
  path.join(root, 'platform/linux/control_frame.c'),
];
const deps = ['gtk+-3.0', 'webkit2gtk-4.1'];

function fail(code, message) {
  process.stderr.write(`${code}: ${message}\n`);
  process.exit(1);
}
function capture(command, args) {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8' });
  if (result.status !== 0) return null;
  return `${result.stdout || ''}${result.stderr || ''}`.trim();
}
function words(text) {
  return text.split(/\s+/).filter(Boolean);
}

if (process.platform !== 'linux') {
  fail('ELECTRON_MBT_UNSUPPORTED_PLATFORM', 'the GTK/WebKitGTK host requires Linux');
}
if (capture('pkg-config', ['--exists', ...deps]) === null) {
  fail('ELECTRON_MBT_LINUX_HOST_DEPS',
    'install the development packages: sudo apt-get install libgtk-3-dev libwebkit2gtk-4.1-dev');
}
if (capture('pkg-config', ['--atleast-version=2.40', 'webkit2gtk-4.1']) === null) {
  fail('ELECTRON_MBT_LINUX_HOST_DEPS', 'WebKitGTK 2.40 or newer is required');
}
const cflags = capture('pkg-config', ['--cflags', ...deps]);
const libs = capture('pkg-config', ['--libs', ...deps]);
if (cflags === null || libs === null) {
  fail('ELECTRON_MBT_LINUX_HOST_DEPS', 'pkg-config did not return GTK/WebKitGTK flags');
}
const gtkVersion = capture('pkg-config', ['--modversion', 'gtk+-3.0']);
const webkitVersion = capture('pkg-config', ['--modversion', 'webkit2gtk-4.1']);
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.rmSync(output, { force: true });
const args = [
  '-std=c11', '-O2', '-Wall', '-Wextra', '-Werror', '-D_GNU_SOURCE',
  ...words(cflags),
  ...sources,
  '-o', output,
  ...words(libs),
];
const build = spawnSync(process.env.CC || 'cc', args, {
  cwd: root, encoding: 'utf8', timeout: 180000,
});
if (build.status !== 0 || !fs.existsSync(output)) {
  process.stderr.write(`${build.stdout || ''}\n${build.stderr || ''}\n`);
  fail('ELECTRON_MBT_LINUX_HOST_BUILD', 'GTK/WebKitGTK host compilation failed');
}
fs.chmodSync(output, 0o755);
const hostSHA256 = crypto.createHash('sha256').update(fs.readFileSync(output)).digest('hex');
process.stdout.write(`${JSON.stringify({
  status: 'PASS',
  output: path.relative(root, output),
  gtk: gtkVersion,
  webkitgtk: webkitVersion,
  hostSHA256,
  sources: sources.map(file => path.relative(root, file)),
}).replace(/\n/g, '')}\n`);
