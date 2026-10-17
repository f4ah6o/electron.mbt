'use strict';
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
function run(label, env) {
  const result = spawnSync('moon', ['run', '--target', 'native', 'native/supervisor'], {
    cwd: root, encoding: 'utf8', timeout: 90000,
    env: { ...process.env, ...env },
  });
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
const cases = [];
cases.push(run('dead-child', { ELECTRON_MBT_SUPERVISOR_BINARY: '/usr/bin/false' }));
cases.push(run('missing-root', { ELECTRON_MBT_SUPERVISOR_ROOT: '/tmp/electron-mbt-no-such-supervisor-root' }));
process.stdout.write(`${JSON.stringify({ status: 'PASS', probe: 'native-supervisor-fault', cases, compatible: false })}\n`);
