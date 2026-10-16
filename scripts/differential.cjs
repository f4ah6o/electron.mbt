'use strict';
// Runs the unchanged oracle fixture under electron.mbt (facade + compiled
// MoonBit core) and lets the core compare its observation against a pinned
// Electron baseline. A "diverged" verdict is data, not a harness failure:
// the script exits 0 once a comparison is produced and 1 only when the
// harness itself cannot run.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { inspectApp, snapshot } = require('../bridges/node/app-files.cjs');
const { parseCandidateObservation } = require('./candidate-observation.cjs');
const manifest = require('../compatibility/manifest.json');
const root = path.resolve(__dirname, '..');
let fixture = path.join(root, 'fixtures/oracle');
const facade = path.join(root, 'bridges/node/electron-facade.cjs');

function fail(message) {
  console.error(`ELECTRON_MBT_DIFFERENTIAL: ${message}`);
  process.exit(1);
}

function loadCore() {
  try {
    return require('../dist/core.cjs');
  } catch {
    fail('build the MoonBit boundary with node scripts/build-core.cjs first');
  }
}

function readBaseline(file) {
  let fd;
  try {
    fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK);
    if (!fs.fstatSync(fd).isFile()) throw new Error('not a regular file');
    // stat alone would not bound allocation if the file grew before readFile.
    const buffer = Buffer.alloc(65537);
    let size = 0;
    while (size < buffer.length) {
      const count = fs.readSync(fd, buffer, size, buffer.length - size, null);
      if (count === 0) break;
      size += count;
    }
    if (size > 65536) throw new Error('baseline exceeds the 65536-byte file limit');
    return buffer.toString('utf8', 0, size);
  } catch (error) { fail(`baseline is not readable: ${file}: ${error.message}`); }
  finally { if (fd !== undefined) fs.closeSync(fd); }
}

function collectBaseline(executable) {
  const result = spawnSync(process.execPath, [path.join(root, 'scripts/oracle.cjs'), executable], { cwd: root, encoding: 'utf8', timeout: 60000, killSignal: 'SIGKILL', maxBuffer: 1024 * 1024 });
  if (result.status !== 0 || result.error || result.signal) fail(`oracle baseline collection failed: ${result.error?.code || result.signal || result.status}; ${result.stderr || result.stdout}`);
  return result.stdout || '';
}

// The fixture must run unchanged. Recognized aborts and deliberate fixture
// failures are observations, not successful app executions. Unclassified child
// failures remain harness errors, and completed markers never mask crashes.
function runMbt() {
  let inspected;
  try { inspected = inspectApp(fixture); } catch (error) { fail(`the fixture cannot be inspected: ${error.message}`); }
  const entry = inspected.entry;
  const bootstrap = [
    `const { installElectronFacade, loadCjs } = require(${JSON.stringify(path.join(root, 'bridges/node/cjs-loader.cjs'))});`,
    `installElectronFacade(${JSON.stringify(facade)});`,
    `loadCjs(${JSON.stringify(entry)});`,
  ].join('\n');
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'electron-mbt-differential-'));
  try {
    const package_ = JSON.parse(fs.readFileSync(path.join(fixture, 'package.json'), 'utf8'));
    const context = { root: fixture, name: package_.name, version: package_.version };
    const result = spawnSync(process.execPath, ['-e', bootstrap], {
      cwd: root, encoding: 'utf8', timeout: 30000, killSignal: 'SIGKILL', maxBuffer: 1024 * 1024,
      env: { ...process.env, ELECTRON_MBT_FACADE_CONTEXT: JSON.stringify(context), ELECTRON_MBT_ORACLE_DATA: data },
    });
    const lines = (result.stdout || '').split(/\r?\n/).filter(line => line.startsWith('ELECTRON_MBT_ORACLE='));
    if (lines.length > 1) fail('the electron.mbt run emitted more than one observation');
    const stderr = result.stderr || '';
    // Only facade-issued diagnostics count as a reported abort; an arbitrary
    // Node error code (MODULE_NOT_FOUND, ERR_*) is an unclassified failure.
    const code = /code: '(ELECTRON_MBT_[A-Z_]+)'/.exec(stderr);
    const api = /^Error: (\S+) is not implemented by electron-mbt/m.exec(stderr);
    const timedOut = result.error && result.error.code === 'ETIMEDOUT';
    if (lines.length === 1) {
      try {
        return parseCandidateObservation(result, lines[0].slice('ELECTRON_MBT_ORACLE='.length));
      } catch (error) {
        fail(error.message);
      }
    }
    if (!timedOut && !code && !api) {
      // Report the thrown error itself, which a plain stack tail can cut off.
      const head = /^(?:Error|TypeError|ReferenceError|SyntaxError)[^\n]*/m.exec(stderr);
      const tail = stderr.trim().split(/\r?\n/).slice(-6).join('\n');
      const detail = [head && head[0].trim(), tail].filter(Boolean).join('\n');
      fail(`the electron.mbt run failed without a recognized diagnostic (status=${result.status}, signal=${result.signal || 'none'})${detail ? `\nstderr detail:\n${detail}` : ''}`);
    }
    const abort = { phase: timedOut ? 'watchdog' : 'evaluate-or-run' };
    if (code) abort.code = code[1];
    if (api) abort.api = api[1];
    const signal = result.signal || (result.error && result.error.signal);
    if (signal) abort.signal = signal;
    return {
      status: 'aborted', moduleIdentity: null, trace: [], observation: null,
      versions: { node: process.versions.node }, platform: process.platform, arch: process.arch,
      abort,
    };
  } finally {
    fs.rmSync(data, { recursive: true, force: true });
  }
}

const args = process.argv.slice(2);
let baselinePath = path.join(root, 'evidence/electron-baseline.json');
let outputPath = path.join(root, 'evidence/differential.json');
let executable = null;
let fixtureOverridden = false;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--baseline' && args[i + 1]) baselinePath = path.resolve(args[++i]);
  else if (args[i] === '--electron' && args[i + 1]) executable = args[++i];
  else if (args[i] === '--fixture' && args[i + 1]) { fixture = path.resolve(args[++i]); fixtureOverridden = true; }
  else if (args[i] === '--output' && args[i + 1]) outputPath = path.resolve(args[++i]);
  else fail(`usage: node scripts/differential.cjs [--baseline <file>] [--electron <abs-exe>] [--fixture <dir>] [--output <file>]`);
}
if (executable !== null && !path.isAbsolute(executable)) fail('--electron requires an absolute executable path');
// scripts/oracle.cjs only knows how to collect fixtures/oracle, so a live
// Electron baseline cannot serve another fixture; use --baseline instead.
if (executable !== null && fixtureOverridden) fail('--electron always collects the baseline from fixtures/oracle; do not combine it with --fixture');

let before;
try { before = snapshot(fixture); } catch (error) { fail(`the fixture cannot be inventoried: ${error.message}`); }
const core = loadCore();
const rawBaseline = executable ? collectBaseline(executable) : readBaseline(baselinePath);
const admission = JSON.parse(core.validate_baseline(rawBaseline, manifest.versions.electronOracle, manifest.versions.nodeOracle, before.sha256));
if (admission.ok !== true) {
  if (admission.field === 'fixtureHash') fail('the baseline was collected from different fixture sources');
  fail(`baseline rejected: ${admission.code} (${admission.field || 'payload'})`);
}
const baseline = JSON.parse(rawBaseline);
const observed = runMbt();
let after;
try { after = snapshot(fixture); } catch (error) { fail(`the fixture cannot be re-inventoried: ${error.message}`); }
if (before.sha256 !== after.sha256) fail('the differential run changed fixture sources');

const verdict = JSON.parse(core.compare_observations(JSON.stringify(baseline.observed), JSON.stringify(observed)));
if (verdict.ok !== true) fail(`the core rejected the comparison: ${JSON.stringify(verdict)}`);

const report = {
  schema: 1,
  status: 'differential-collected',
  compatible: false,
  fixtureHash: before.sha256,
  fileHashes: before.files,
  baseline: { source: executable ? 'electron-executable' : baselinePath, observed: baseline.observed },
  mbt: { runtime: 'electron.mbt-facade', observed },
  comparison: verdict,
  note: 'One unchanged fixture under both runtimes. A divergence records the current M0 gap; an equivalent verdict on this fixture alone is not a compatibility result.',
};
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report));
