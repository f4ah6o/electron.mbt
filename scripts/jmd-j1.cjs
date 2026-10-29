'use strict';
// J1: run the pinned jmd v0.2.3 main under the adapted runtime. The expected
// outcome is a typed rejection before any window or scheme registration. The
// first gate may be the CJS loader (JMD_SMOKE computed require) rather than the
// protocol declaration; the report records which gate was reached instead of
// pretending the protocol was exercised.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { buildSourceManifest, writeSourceManifest } = require('./source-manifest.cjs');

const root = path.resolve(__dirname, '..');
const revision = 'f875fc616feb89ea803a0fc140ec770a2ade041e';
const source = path.resolve(process.env.JMD_ROOT || path.join(root, '_build/jmd-j1-src'));
const stage = path.join(root, '_build/jmd-j1-stage');
const reportPath = path.join(root, 'compatibility/reports/jmd-j1.json');
const binaryCandidates = [
  path.join(root, 'dist/emoon'),
  path.join(root, '_build/native/debug/build/cmd/emoon/emoon.exe'),
  path.join(root, '_build/native/debug/build/cmd/emoon/emoon'),
];
const binary = binaryCandidates.find(candidate => fs.existsSync(candidate));

function hash(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function writeReport(report) {
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
}

function skip(reason) {
  writeReport({
    schema: 1,
    probe: 'jmd-j1',
    status: 'NOT_RUN',
    reason,
    revision,
    compatible: false,
  });
  console.log(JSON.stringify({ status: 'NOT_RUN', reason }));
  process.exit(0);
}

if (!fs.existsSync(path.join(source, 'electron/main.js'))) {
  skip(`pinned jmd source is not available at ${path.relative(root, source)}; set JMD_ROOT`);
}
const head = spawnSync('git', ['-C', source, 'rev-parse', 'HEAD'], { encoding: 'utf8' });
if (head.status !== 0 || head.stdout.trim() !== revision) {
  skip(`checkout is not the pinned revision ${revision}`);
}
if (!binary) skip('emoon binary is not built');

const report = {
  schema: 1,
  probe: 'jmd-j1',
  status: 'FAIL',
  compatible: false,
  revision,
  environment: {
    platform: process.platform,
    node: process.version,
    cliSHA256: hash(binary),
  },
  source: {
    mainSHA256: hash(path.join(source, 'electron/main.js')),
    updaterSHA256: hash(path.join(source, 'electron/updater.js')),
    packageSHA256: hash(path.join(source, 'package.json')),
  },
};

try {
  fs.rmSync(stage, { recursive: true, force: true });
  fs.mkdirSync(path.join(stage, 'electron'), { recursive: true });
  for (const file of ['package.json', 'electron/main.js', 'electron/updater.js', 'electron/preload.js']) {
    fs.mkdirSync(path.dirname(path.join(stage, file)), { recursive: true });
    fs.copyFileSync(path.join(source, file), path.join(stage, file));
  }
  const files = ['package.json', 'electron/main.js', 'electron/updater.js', 'electron/preload.js'];
  const manifest = buildSourceManifest(stage, 'electron/main.js', 'jmd', files);
  writeSourceManifest(path.join(stage, 'source-manifest.json'), manifest);
  report.stage = {
    files: manifest.files.length,
    manifestSHA256: hash(path.join(stage, 'source-manifest.json')),
  };
  const result = spawnSync(binary, ['run', stage], {
    cwd: root,
    encoding: 'utf8',
    timeout: 30000,
    env: { ...process.env, JMD_SMOKE: '' },
  });
  const lines = `${result.stdout || ''}\n${result.stderr || ''}`.split('\n')
    .map(line => line.trim()).filter(line => line.startsWith('{') && line.endsWith('}'));
  let parsed = null;
  if (lines.length > 0) {
    try { parsed = JSON.parse(lines.at(-1)); } catch { parsed = null; }
  }
  report.command = { exitCode: result.status, report: parsed };
  const firstGate = parsed && parsed.code ? parsed.code : '';
  const expected = result.status !== 0 && (
    firstGate === 'ELECTRON_MBT_DYNAMIC_REQUIRE' ||
    firstGate === 'ELECTRON_MBT_MAIN_EVAL' ||
    firstGate === 'ELECTRON_MBT_MODULE_DEPENDENCY'
  );
  report.firstGate = firstGate;
  report.protocolGateReached = firstGate === 'ELECTRON_MBT_MAIN_EVAL' &&
    typeof parsed.message === 'string' &&
    parsed.message.includes('ELECTRON_MBT_UNSUPPORTED_PROTOCOL_PRIVILEGE');
  if (!expected) {
    report.problems = ['pinned jmd did not fail closed with a typed pre-window rejection'];
    writeReport(report);
    console.error(JSON.stringify({ status: 'FAIL', firstGate }));
    process.exit(1);
  }
  report.status = 'PASS';
  report.verdict = 'expected-rejection';
  report.note = firstGate === 'ELECTRON_MBT_DYNAMIC_REQUIRE'
    ? 'The pinned jmd main is rejected by the CJS loader (JMD_SMOKE computed require) before the protocol declaration. This is a fail-closed expected-rejection, not protocol-gate evidence; the synthetic J1 fixture covers the bypassCSP rejection.'
    : 'The pinned jmd main is rejected before a window; see firstGate.';
  writeReport(report);
  console.log(JSON.stringify({
    status: 'PASS',
    firstGate,
    protocolGateReached: report.protocolGateReached,
  }));
} finally {
  fs.rmSync(stage, { recursive: true, force: true });
}
