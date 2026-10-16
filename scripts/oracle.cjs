'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { snapshot } = require('../bridges/node/app-files.cjs');
const manifest = require('../compatibility/manifest.json');
const root = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const executable = args[0];
let outputPath = path.join(root, 'evidence/electron-baseline.json');
const validArgs = args.length === 1 || (args.length === 3 && args[1] === '--output' && args[2]);
let executableIsFile = false;
try { executableIsFile = typeof executable === 'string' && path.isAbsolute(executable) && fs.statSync(executable).isFile(); } catch {}
if (!executableIsFile || !validArgs) {
  console.error('ELECTRON_MBT_ORACLE: supply an absolute path to the separately installed pinned Electron executable [--output <file>]'); process.exit(1);
}
if (args.length === 3) outputPath = path.resolve(args[2]);
const fixture = path.join(root, 'fixtures/oracle');
let data;
try {
  const core = require('../dist/core.cjs');
  const before = snapshot(fixture);
  data = fs.mkdtempSync(path.join(os.tmpdir(), 'electron-mbt-oracle-'));
  // Disabling Chromium's sandbox would invalidate the security baseline.
  const result = spawnSync(executable, [fixture], { cwd: root, encoding: 'utf8', timeout: 25000, killSignal: 'SIGKILL', maxBuffer: 1024 * 1024, env: { ...process.env, ELECTRON_MBT_ORACLE_DATA: data } });
  if (result.status !== 0 || result.error || result.signal) throw new Error(`Oracle execution failed: ${result.error?.code || result.signal || result.status}; ${result.stderr || ''}`);
  const lines = (result.stdout || '').split(/\r?\n/).filter(line => line.startsWith('ELECTRON_MBT_ORACLE='));
  if (lines.length !== 1) throw new Error('Oracle must emit exactly one result');
  const observed = JSON.parse(lines[0].slice('ELECTRON_MBT_ORACLE='.length));
  const after = snapshot(fixture);
  if (before.sha256 !== after.sha256) throw new Error('Oracle fixture sources changed');
  const report = { schema: 1, status: 'baseline-collected', compatible: false, fixtureHash: before.sha256, fileHashes: before.files, observed, note: 'Reference runtime observations only. No electron.mbt differential result or size claim.' };
  const raw = JSON.stringify(report);
  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  const admission = JSON.parse(core.validate_baseline(serialized, manifest.versions.electronOracle, manifest.versions.nodeOracle, before.sha256));
  if (admission.ok !== true) throw new Error(`baseline rejected: ${admission.code} (${admission.field || 'payload'})`);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, serialized);
  console.log(raw);
} catch (error) { console.error(`ELECTRON_MBT_ORACLE: ${error.message}`); process.exitCode = 1; }
finally { if (data) fs.rmSync(data, { recursive: true, force: true }); }
