'use strict';
// Build the native emoon CLI and the platform host, then copy both into dist/
// so the Node reference CLI can resolve them without a PATH install.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const build = spawnSync('moon', ['build', '--target', 'native', 'cmd/emoon'], {
  cwd: root, encoding: 'utf8', timeout: 300000,
});
if (build.status !== 0) {
  process.stderr.write(`${build.stdout || ''}\n${build.stderr || ''}\n`);
  process.exit(1);
}
const candidates = [
  path.join(root, '_build/native/debug/build/cmd/emoon/emoon.exe'),
  path.join(root, '_build/native/debug/build/cmd/emoon/emoon'),
];
const binary = candidates.find(candidate => fs.existsSync(candidate));
if (!binary) {
  process.stderr.write('emoon binary was not produced\n');
  process.exit(1);
}
fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
const output = path.join(root, 'dist', process.platform === 'win32' ? 'emoon.exe' : 'emoon');
fs.copyFileSync(binary, output);
fs.chmodSync(output, 0o755);

const host = path.join(root, 'dist/emoon-host');
if (process.platform === 'darwin') {
  const built = spawnSync(process.execPath, ['scripts/build-macos-host.cjs'], { cwd: root, encoding: 'utf8', timeout: 300000 });
  if (built.status !== 0) {
    process.stderr.write(`macOS host build failed\n${built.stdout || ''}\n${built.stderr || ''}\n`);
    process.exit(1);
  }
} else if (process.platform === 'linux') {
  const built = spawnSync(process.execPath, ['scripts/build-linux-host.cjs'], { cwd: root, encoding: 'utf8', timeout: 300000 });
  if (built.status !== 0) {
    process.stderr.write(`Linux host build failed\n${built.stdout || ''}\n${built.stderr || ''}\n`);
    process.exit(1);
  }
} else {
  process.stderr.write(`unsupported host platform: ${process.platform}\n`);
  process.exit(1);
}
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
process.stdout.write(`${JSON.stringify({
  ok: true,
  cli: path.relative(root, output),
  cliSHA256: hash(output),
  host: path.relative(root, host),
  hostSHA256: fs.existsSync(host) ? hash(host) : null,
})}\n`);
