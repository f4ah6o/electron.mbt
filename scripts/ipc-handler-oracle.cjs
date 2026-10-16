'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { snapshot } = require('../bridges/node/app-files.cjs');
const manifest = require('../compatibility/manifest.json');
const core = require('../dist/core.cjs');
const root = path.resolve(__dirname, '..');
const fixture = path.join(root, 'fixtures/ipc-handlers');
const marker = 'ELECTRON_MBT_INVOKE=';

function observation(result, label) {
  assert.equal(result.error, undefined, `${label}: ${result.error?.message}`);
  assert.equal(result.signal, null, `${label}: signal ${result.signal}`);
  assert.equal(result.status, 0, `${label}: ${result.stderr || result.stdout}`);
  const lines = result.stdout.split(/\r?\n/).filter(line => line.startsWith(marker));
  assert.equal(lines.length, 1, `${label}: expected one observation`);
  assert.ok(lines[0].length <= 16384, `${label}: oversized observation`);
  const value = JSON.parse(lines[0].slice(marker.length));
  assert.equal(value.status, 'completed');
  assert.equal(value.trace.length, 16);
  for (const row of value.trace) assert.equal(row[1], true);
  return value;
}

function main() {
  const executable = process.argv[2];
  if (process.argv.length !== 3 || !executable || !path.isAbsolute(executable)) {
    throw new Error('usage: node scripts/ipc-handler-oracle.cjs <absolute-pinned-electron>');
  }
  const before = snapshot(fixture);
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'electron-mbt-handler-oracle-'));
  try {
    const options = label => {
      const data = path.join(temporary, label);
      fs.mkdirSync(data);
      const env = { ...process.env, ELECTRON_MBT_ORACLE_DATA: data };
      delete env.ELECTRON_RUN_AS_NODE;
      delete env.NODE_OPTIONS;
      return { cwd: root, env, encoding: 'utf8', timeout: 45000, killSignal: 'SIGKILL', maxBuffer: 1024 * 1024 };
    };
    const reference = observation(spawnSync(executable, [fixture], options('reference')), 'Electron reference');
    assert.equal(snapshot(fixture).sha256, before.sha256, 'reference changed fixture sources');
    const baseline = { schema: 1, status: 'baseline-collected', compatible: false, fixtureHash: before.sha256, observed: reference };
    const admission = JSON.parse(core.validate_baseline(JSON.stringify(baseline), manifest.versions.electronOracle, manifest.versions.nodeOracle, before.sha256));
    assert.equal(admission.ok, true, `reference rejected: ${JSON.stringify(admission)}`);
    assert.equal(reference.platform, 'darwin');
    assert.equal(reference.arch, 'arm64');
    const candidate = observation(spawnSync(process.execPath, [path.join(fixture, 'candidate.cjs')], options('candidate')), 'candidate kernel');
    assert.equal(candidate.platform, reference.platform);
    assert.equal(candidate.arch, reference.arch);
    assert.equal(candidate.versions.node, manifest.versions.nodeOracle);
    assert.equal(snapshot(fixture).sha256, before.sha256, 'candidate changed fixture sources');
    // The drivers differ: Electron uses real renderer IPC, while the candidate
    // uses a synthetic trusted-host driver. Comparing module or sender identity
    // would misrepresent this handler-only contract as end-to-end compatibility.
    const project = value => ({ status: value.status, trace: value.trace, observation: value.observation });
    const comparison = JSON.parse(core.compare_observations(JSON.stringify(project(reference)), JSON.stringify(project(candidate))));
    assert.equal(comparison.ok, true);
    assert.equal(comparison.verdict, 'equivalent', JSON.stringify(comparison));
    assert.equal(comparison.compatible, false);
    const report = {
      schema: 1, status: 'handler-contract-equivalent', compatible: false,
      referenceTransport: 'real Electron renderer IPC with isolated sandboxed preload',
      candidateTransport: 'production invocation kernel; synthetic trusted-host metadata; no renderer',
      comparisonScope: ['status', 'trace', 'observation'],
      fixtureHash: before.sha256, fileHashes: before.files,
      reference, candidate, comparison,
      note: 'Shared scenario sources unchanged. Different explicit drivers. Not an unchanged application, native sender-attestation result, or electron.mbt renderer IPC E2E.',
    };
    fs.mkdirSync(path.join(root, 'evidence'), { recursive: true });
    fs.writeFileSync(path.join(root, 'evidence/ipc-main-handlers.json'), `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify(report));
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
}

try { main(); } catch (error) {
  console.error(`ELECTRON_MBT_HANDLER_ORACLE: ${error.message}`);
  process.exitCode = 1;
}
