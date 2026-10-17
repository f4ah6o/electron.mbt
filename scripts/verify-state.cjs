'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const checks = [
  { id: 'moon-js', command: 'moon', args: ['test', '--target', 'js'], expect: 0 },
  { id: 'moon-native', command: 'moon', args: ['test', '--target', 'native'], expect: 0 },
  { id: 'npm-test', command: 'npm', args: ['test'], expect: 0 },
  { id: 'build', command: 'npm', args: ['run', 'build'], expect: 0 },
  { id: 'native-host-build', command: 'node', args: ['scripts/build-macos-host.cjs'], expect: 0 },
  { id: 'm1-smoke', command: 'node', args: ['scripts/m1-macos-smoke.cjs'], expect: 0 },
  { id: 'm1-app-smoke', command: 'node', args: ['scripts/m1-app-smoke.cjs'], expect: 0 },
  { id: 'native-supervisor', command: 'node', args: ['scripts/m1-native-supervisor.cjs'], expect: 0 },
  { id: 'native-supervisor-fault', command: 'node', args: ['scripts/m1-native-supervisor-fault.cjs'], expect: 0 },
  { id: 'native-supervisor-retry', command: 'node', args: ['scripts/m1-native-supervisor-retry.cjs'], expect: 0 },
  { id: 'source-snapshot', command: 'node', args: ['scripts/m1-source-snapshot.cjs'], expect: 0 },
  { id: 'adapted-preload', command: 'node', args: ['scripts/adapted-preload-check.cjs'], expect: 0 },
  { id: 'adapted-api', command: 'node', args: ['scripts/adapted-api-check.cjs'], expect: 0 },
  { id: 'readiness', command: 'node', args: ['scripts/preview-readiness.cjs'], expect: 2 },
  { id: 'gate-report', command: 'node', args: ['scripts/gate-report.cjs'], expect: 0 },
];
const results = [];
for (const check of checks) {
  const result = spawnSync(check.command, check.args, {
    cwd: root, encoding: 'utf8', timeout: 300000, maxBuffer: 8 * 1024 * 1024,
  });
  const output = `${result.stdout || ''}\n${result.stderr || ''}`.trim();
  const lines = output.split('\n').map(line => line.trim()).filter(Boolean);
  const jsonLine = lines.filter(line => line.startsWith('{') && line.endsWith('}')).at(-1);
  let json = null;
  try { json = jsonLine ? JSON.parse(jsonLine) : null; } catch {}
  const exit = result.status === null ? -1 : result.status;
  const ok = exit === check.expect;
  let detail = lines.at(-1) || '';
  if (json && typeof json === 'object') {
    detail = { status: json.status, probe: json.probe, code: json.code, counts: json.counts };
    if (Array.isArray(json.cases)) {
      detail.cases = json.cases.map(item => ({ label: item.label, status: item.status, code: item.code }));
    }
  }
  results.push({
    id: check.id,
    status: ok ? (check.id === 'readiness' ? 'NOT_READY' : 'PASS') : 'FAIL',
    exit,
    expectedExit: check.expect,
    detail,
  });
}
const failed = results.filter(result => result.status === 'FAIL');
const report = {
  schema: 1,
  status: failed.length === 0 ? 'NOT_READY' : 'FAIL',
  compatible: false,
  checks: results,
  note: 'NOT_READY is the expected overall state. FAIL means a command or expected exit code did not hold.',
};
const output = path.join(root, 'compatibility/reports/verification.json');
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ status: report.status, checks: results.length, failed: failed.map(result => result.id), out: path.relative(root, output) })}\n`);
if (failed.length > 0) process.exitCode = 1;
