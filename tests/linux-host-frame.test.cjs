'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const ccAvailable = spawnSync('cc', ['--version'], { stdio: 'ignore' }).status === 0;

test('the Linux host rejects non-canonical control frames', {
  skip: process.platform !== 'linux' || !ccAvailable,
}, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'electron-mbt-control-frame-'));
  try {
    const binary = path.join(dir, 'control_frame_test');
    const build = spawnSync('cc', [
      '-std=c11', '-O2', '-Wall', '-Wextra', '-Werror',
      '-o', binary,
      path.join(root, 'tests/linux/control_frame_test.c'),
      path.join(root, 'platform/linux/control_frame.c'),
    ], { cwd: root, encoding: 'utf8' });
    assert.equal(build.status, 0, `${build.stdout}\n${build.stderr}`);
    const run = spawnSync(binary, [], { cwd: root, encoding: 'utf8' });
    assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);
    assert.match(run.stdout, /control_frame: PASS/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
