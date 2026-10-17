'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
function run(label, env) {
  const result = spawnSync('moon', ['run', '--target', 'native', 'native/supervisor'], {
    cwd: root, encoding: 'utf8', timeout: 90000,
    env: { ...process.env, ...env },
  });
  fs.rmSync(path.join(root, 'fixtures/native-app/broker-output.txt'), { force: true });
  const lines = `${result.stdout || ''}\n${result.stderr || ''}`.split('\n').map(line => line.trim()).filter(Boolean);
  const report = lines.filter(line => line.startsWith('{') && line.endsWith('}')).at(-1);
  let parsed;
  try { parsed = JSON.parse(report); } catch {
    throw new Error(`${label}: no JSON report\n${result.stdout}\n${result.stderr}`);
  }
  if (result.status !== 1 || parsed.status !== 'FAIL' || parsed.compatible !== false) {
    throw new Error(`${label}: unexpected result ${JSON.stringify(parsed)} status=${result.status}`);
  }
  return { label, status: 'PASS', code: parsed.code };
}
const sleepDir = fs.mkdtempSync(path.join(os.tmpdir(), 'electron-mbt-supervisor-sleep-'));
const sleepBinary = path.join(sleepDir, 'sleep.sh');
fs.writeFileSync(sleepBinary, '#!/bin/sh\nexec sleep 30\n', { mode: 0o755 });
process.once('exit', () => fs.rmSync(sleepDir, { recursive: true, force: true }));
const cases = [];
cases.push(run('dead-child', { ELECTRON_MBT_SUPERVISOR_BINARY: '/usr/bin/false' }));
cases.push(run('missing-root', { ELECTRON_MBT_SUPERVISOR_ROOT: '/tmp/electron-mbt-no-such-supervisor-root' }));
cases.push(run('entry-traversal', { ELECTRON_MBT_SUPERVISOR_ROOT: path.join(root, 'fixtures/native-app-invalid') }));
cases.push(run('handshake-timeout', {
  ELECTRON_MBT_SUPERVISOR_BINARY: sleepBinary,
  ELECTRON_MBT_SUPERVISOR_TIMEOUT_MS: '500',
}));
process.stdout.write(`${JSON.stringify({ status: 'PASS', probe: 'native-supervisor-fault', cases, compatible: false })}\n`);
