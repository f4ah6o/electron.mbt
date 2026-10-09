#!/usr/bin/env node
'use strict';
const path = require('node:path');
const fs = require('node:fs');
const { inspectApp, snapshot } = require('../bridges/node/app-files.cjs');
const { runtimeError } = require('../bridges/node/errors.cjs');
const manifest = require('../compatibility/manifest.json');

function core() {
  const compiled = path.resolve(__dirname, '../dist/core.cjs');
  if (!fs.existsSync(compiled)) throw runtimeError('ELECTRON_MBT_NOT_BUILT', 'Build the MoonBit boundary with node scripts/build-core.cjs.');
  return require(compiled);
}
function report(value) { process.stdout.write(`${JSON.stringify(value, null, 2)}\n`); }
function main(args) {
  const [command, appDir, ...extra] = args;
  if (command === '--version' && args.length === 1) { report({ version: '0.0.1', milestone: manifest.milestone, compatible: false }); return 0; }
  if (command === '--help' && args.length === 1) {
    report({ usage: 'electron-mbt <doctor|snapshot|compat-check|run|pack> <app-dir>', run: 'not implemented: M0 gates remain open', pack: 'not implemented: no distributable runtime' }); return 0;
  }
  if (!['doctor', 'snapshot', 'compat-check', 'run', 'pack'].includes(command) || !appDir || extra.length) {
    throw runtimeError('ELECTRON_MBT_USAGE', 'Use electron-mbt <doctor|snapshot|compat-check|run|pack> <app-dir>.');
  }
  if (command === 'run' || command === 'pack') {
    // Executing a main entry would imply a runtime exists; a diagnostic is not one.
    throw runtimeError('ELECTRON_MBT_M0_INCOMPLETE', `${command} is unavailable: synchronous isolated contextBridge and native host gates remain open.`);
  }
  if (command === 'snapshot') { report(snapshot(appDir)); return 0; }
  const app = inspectApp(appDir);
  const diagnosis = JSON.parse(core().diagnose(JSON.stringify({
    entryType: app.entryType, nativeAddons: app.nativeAddons, platform: process.platform,
  })));
  report({
    ...diagnosis, command, profile: manifest.profile, milestone: manifest.milestone,
    app: { name: app.name, version: app.version, entry: path.relative(app.root, app.entry), sourceHash: app.inventory.sha256, fileCount: app.inventory.files.length, bytes: app.inventory.totalBytes },
    environment: { node: process.versions.node, platform: process.platform, arch: process.arch },
    inventory: { nativeAddons: app.nativeAddons, asar: app.asar },
    gates: manifest.gates,
    limitation: 'Static inventory does not execute the app, establish runtime compatibility, or replace differential/native tests.',
  });
  return 2;
}
if (require.main === module) {
  try { process.exitCode = main(process.argv.slice(2)); }
  catch (error) { report({ ok: false, compatible: false, code: error.code || 'ELECTRON_MBT_IO', message: error.message }); process.exitCode = 1; }
}
module.exports = { main };
