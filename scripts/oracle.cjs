'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { snapshot } = require('../bridges/node/app-files.cjs');
const manifest = require('../compatibility/manifest.json');
const root = path.resolve(__dirname, '..');
const executable = process.argv[2];
let executableIsFile = false;
try { executableIsFile = typeof executable === 'string' && path.isAbsolute(executable) && fs.statSync(executable).isFile(); } catch {}
if (!executableIsFile || process.argv.length !== 3) {
  console.error('ELECTRON_MBT_ORACLE: supply an absolute path to the separately installed pinned Electron executable'); process.exit(1);
}
const fixture = path.join(root, 'fixtures/oracle');
const before = snapshot(fixture);
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'electron-mbt-oracle-'));
let report;
try {
  // Disabling Chromium's sandbox would invalidate the security baseline.
  const result = spawnSync(executable, [fixture], { cwd: root, encoding: 'utf8', timeout: 25000, killSignal: 'SIGKILL', maxBuffer: 1024 * 1024, env: { ...process.env, ELECTRON_MBT_ORACLE_DATA: data } });
  if (result.status !== 0) throw new Error(`Oracle execution failed: ${result.error?.code || result.signal || result.status}; ${result.stderr || ''}`);
  const lines = result.stdout.split(/\r?\n/).filter(line => line.startsWith('ELECTRON_MBT_ORACLE='));
  if (lines.length !== 1) throw new Error('Oracle must emit exactly one result');
  const observed = JSON.parse(lines[0].slice('ELECTRON_MBT_ORACLE='.length));
  if (observed.status !== 'completed' || observed.versions.electron !== manifest.versions.electronOracle || observed.versions.node !== manifest.versions.nodeOracle) throw new Error('Oracle version or completion mismatch');
  const after = snapshot(fixture);
  if (before.sha256 !== after.sha256) throw new Error('Oracle fixture sources changed');
  report = { schema: 1, status: 'baseline-collected', compatible: false, fixtureHash: before.sha256, fileHashes: before.files, observed, note: 'Reference runtime observations only. No electron.mbt differential result or size claim.' };
  fs.mkdirSync(path.join(root, 'evidence'), { recursive: true });
  fs.writeFileSync(path.join(root, 'evidence/electron-baseline.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report));
} catch (error) { console.error(error.message); process.exitCode = 1; }
finally { fs.rmSync(data, { recursive: true, force: true }); }
