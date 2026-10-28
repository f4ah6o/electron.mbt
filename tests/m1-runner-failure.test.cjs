'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const host = path.join(root, 'dist/emoon-host');
const skip = process.platform !== 'darwin' || !fs.existsSync(host);

test('the M1 runner turns an unhandled app rejection into a structured failure', { skip }, (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'electron-mbt-m1-failure-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const app = path.join(directory, 'app');
  fs.mkdirSync(app);
  fs.writeFileSync(path.join(app, 'package.json'), JSON.stringify({ name: 'm1-failure', version: '0.0.0', main: 'main.cjs' }));
  fs.writeFileSync(path.join(app, 'main.cjs'), "Promise.reject(new Error('fixture-async-failure'));\n");
  const userData = path.join(directory, 'userdata');
  const result = spawnSync(process.execPath, ['cmd/legacy-node.cjs', 'run', app, '--experimental-m1'], {
    cwd: root, encoding: 'utf8', timeout: 60000,
    env: { ...process.env, ELECTRON_MBT_M1_USER_DATA_ROOT: userData, HOME: path.join(directory, 'home'), TMPDIR: path.join(directory, 'tmp') },
  });
  assert.equal(result.status, 1, result.stderr || result.stdout);
  const report = JSON.parse(result.stdout);
  assert.equal(report.ok, false);
  assert.equal(report.compatible, false);
  assert.equal(report.code, 'ELECTRON_MBT_APP_ERROR');
  assert.match(report.message, /fixture-async-failure/);
  assert.doesNotMatch(result.stderr, /UnhandledPromiseRejection|throw er;/);
});
