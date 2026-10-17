#!/usr/bin/env node
'use strict';
const path = require('node:path');
const fs = require('node:fs');
const { inspectApp, snapshot } = require('../bridges/node/app-files.cjs');
const { runtimeError } = require('../bridges/node/errors.cjs');
const manifest = require('../compatibility/manifest.json');
const profileConfigPath = path.resolve(__dirname, '../compatibility/runtime-profiles-v1.json');
const commands = ['doctor', 'snapshot', 'compat-check', 'run', 'pack'];

function core() {
  const compiled = path.resolve(__dirname, '../dist/core.cjs');
  if (!fs.existsSync(compiled)) throw runtimeError('ELECTRON_MBT_NOT_BUILT', 'Build the MoonBit boundary with node scripts/build-core.cjs.');
  return require(compiled);
}
function report(value) { process.stdout.write(`${JSON.stringify(value, null, 2)}\n`); }

// `--profile` is admission input, not a compatibility claim. The same profile
// contract is also consumed by tests so the leaf does not invent a second
// profile state machine.
function parseArgs(args) {
  const positional = [];
  const selection = { profile: null, inputMode: '', preloadMode: '', runtime: '' };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--profile' || arg === '--input-mode' || arg === '--preload-mode' || arg === '--runtime') {
      const value = args[i + 1];
      if (value === undefined || value.startsWith('--')) {
        throw runtimeError('ELECTRON_MBT_USAGE', `${arg} requires a value.`);
      }
      i += 1;
      if (arg === '--profile') selection.profile = value;
      else if (arg === '--input-mode') selection.inputMode = value;
      else if (arg === '--preload-mode') selection.preloadMode = value;
      else selection.runtime = value;
    } else if (arg.startsWith('--')) {
      throw runtimeError('ELECTRON_MBT_USAGE', `Unknown option ${arg}.`);
    } else {
      positional.push(arg);
    }
  }
  return {
    command: positional[0],
    appDir: positional[1],
    extra: positional.slice(2),
    ...selection,
  };
}

function admitProfile(selection) {
  let raw;
  try { raw = fs.readFileSync(profileConfigPath, 'utf8'); }
  catch (error) { throw runtimeError('ELECTRON_MBT_PROFILE_CONFIG', `Cannot read the profile contract: ${error.message}`); }
  const result = JSON.parse(core().validate_profile(
    raw, selection.profile, selection.inputMode, selection.preloadMode, selection.runtime,
  ));
  return result;
}

function main(argv) {
  if (argv.length === 1 && argv[0] === '--version') { report({ version: '0.0.1', milestone: manifest.milestone, compatible: false }); return 0; }
  if (argv.length === 1 && argv[0] === '--help') {
    report({
      usage: 'electron-mbt <doctor|snapshot|compat-check|run|pack> <app-dir> [--profile <id>] [--input-mode <mode>] [--preload-mode <mode>] [--runtime <runtime>]',
      profiles: 'compatibility/runtime-profiles-v1.json',
      run: 'not implemented: M0 gates remain open',
      pack: 'not implemented: no distributable runtime',
    }); return 0;
  }
  const { command, appDir, extra, profile, inputMode, preloadMode, runtime } = parseArgs(argv);
  if (!commands.includes(command) || !appDir || extra.length) {
    throw runtimeError('ELECTRON_MBT_USAGE', 'Use electron-mbt <doctor|snapshot|compat-check|run|pack> <app-dir>.');
  }
  if (profile !== null && command !== 'doctor' && command !== 'compat-check') {
    throw runtimeError('ELECTRON_MBT_USAGE', '--profile is accepted only by doctor and compat-check.');
  }
  if (command === 'run' || command === 'pack') {
    // Executing a main entry would imply a runtime exists; a diagnostic is not one.
    throw runtimeError('ELECTRON_MBT_M0_INCOMPLETE', `${command} is unavailable: synchronous isolated contextBridge and native host gates remain open.`);
  }
  if (command === 'snapshot') { report(snapshot(appDir)); return 0; }
  let profileAdmission;
  if (profile !== null) {
    profileAdmission = admitProfile({ profile, inputMode, preloadMode, runtime });
    if (profileAdmission.ok !== true) {
      report({
        ...profileAdmission,
        command,
        milestone: manifest.milestone,
        limitation: 'Profile admission rejected the combination before app evaluation; this is not a compatibility result.',
      });
      return 2;
    }
  }
  const app = inspectApp(appDir);
  const diagnosis = JSON.parse(core().diagnose(JSON.stringify({
    entryType: app.entryType, nativeAddons: app.nativeAddons, platform: process.platform,
  })));
  report({
    ...diagnosis, command, profile: manifest.profile, requestedProfile: profile,
    profileAdmission: profileAdmission || null,
    milestone: manifest.milestone,
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
module.exports = { main, parseArgs, admitProfile };
