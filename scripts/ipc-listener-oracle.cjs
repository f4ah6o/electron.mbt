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
const fixture = path.join(root, 'fixtures/ipc-listeners');
const marker = 'ELECTRON_MBT_IPC_LISTENERS=';

function readObservation(result, label) {
  assert.equal(result.error, undefined, `${label}: ${result.error?.message}`);
  assert.equal(result.signal, null, `${label}: terminated by ${result.signal}`);
  assert.equal(result.status, 0, `${label}: ${result.stderr || result.stdout}`);
  const lines = result.stdout.split(/\r?\n/).filter(line => line.startsWith(marker));
  assert.equal(lines.length, 1, `${label}: expected exactly one observation`);
  assert.ok(lines[0].length <= 16384, `${label}: oversized observation`);
  return JSON.parse(lines[0].slice(marker.length));
}

function main() {
  const executable = process.argv[2];
  if (process.argv.length !== 3 || !executable || !path.isAbsolute(executable)) {
    throw new Error('usage: node scripts/ipc-listener-oracle.cjs <absolute-pinned-electron>');
  }
  const before = snapshot(fixture);
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'electron-mbt-ipc-oracle-'));
  try {
    const options = label => {
      const data = path.join(temporary, label);
      fs.mkdirSync(data);
      const env = { ...process.env, ELECTRON_MBT_ORACLE_DATA: data };
      delete env.ELECTRON_RUN_AS_NODE;
      delete env.NODE_OPTIONS;
      return { cwd: root, env, encoding: 'utf8', timeout: 30000, killSignal: 'SIGKILL', maxBuffer: 1024 * 1024 };
    };
    const reference = readObservation(spawnSync(executable, [fixture], options('reference')), 'Electron');
    assert.equal(snapshot(fixture).sha256, before.sha256, 'Electron changed the fixture');
    const baseline = { schema: 1, status: 'baseline-collected', compatible: false, fixtureHash: before.sha256, observed: reference };
    const admission = JSON.parse(core.validate_baseline(JSON.stringify(baseline), manifest.versions.electronOracle, manifest.versions.nodeOracle, before.sha256));
    assert.equal(admission.ok, true, `reference rejected: ${JSON.stringify(admission)}`);
    assert.equal(reference.platform, 'darwin', 'this acceptance target is macOS');
    assert.equal(reference.arch, 'arm64', 'this acceptance target is Apple Silicon');
    const bootstrap = [
      `const { installElectronFacade, loadCjs } = require(${JSON.stringify(path.join(root, 'bridges/node/cjs-loader.cjs'))});`,
      `installElectronFacade(${JSON.stringify(path.join(root, 'bridges/node/electron-facade.cjs'))});`,
      `loadCjs(${JSON.stringify(path.join(fixture, 'main.cjs'))});`,
    ].join('\n');
    const candidateOptions = options('candidate');
    candidateOptions.env.ELECTRON_MBT_FACADE_CONTEXT = JSON.stringify({ root: fixture, name: 'electron-mbt-ipc-listeners-fixture', version: '0.0.0' });
    const candidate = readObservation(spawnSync(process.execPath, ['-e', bootstrap], candidateOptions), 'electron.mbt');
    assert.equal(snapshot(fixture).sha256, before.sha256, 'electron.mbt changed the fixture');
    const comparison = JSON.parse(core.compare_observations(JSON.stringify(reference), JSON.stringify(candidate)));
    assert.equal(comparison.ok, true);
    assert.equal(comparison.verdict, 'equivalent', JSON.stringify(comparison));
    assert.equal(comparison.compatible, false);
    const report = {
      schema: 1, status: 'listener-contract-equivalent', compatible: false,
      scope: 'main-local-listener-contract; no renderer transport or sender authentication',
      fixtureHash: before.sha256, fileHashes: before.files, reference, candidate, comparison,
    };
    fs.mkdirSync(path.join(root, 'evidence'), { recursive: true });
    fs.writeFileSync(path.join(root, 'evidence/ipc-main-listeners.json'), `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify(report));
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

try { main(); } catch (error) {
  console.error(`ELECTRON_MBT_IPC_ORACLE: ${error.message}`);
  process.exitCode = 1;
}
