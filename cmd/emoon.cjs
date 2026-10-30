#!/usr/bin/env node
'use strict';
// Node reference CLI for Electromoon. It keeps the developer workflow available
// without reimplementing the runtime: doctor/run are delegated to native emoon.
const fs = require('node:fs');
const path = require('node:path');
const migrate = require('../scripts/migrate-app.cjs');
const flow = require('../scripts/dev-flow.cjs');
const VERSION = '0.1.0';

function runtimeForVersion() {
  try { return flow.resolveRuntime({ appDir: process.cwd() }); } catch { return null; }
}
function printVersion(asJson) {
  const runtime = runtimeForVersion();
  if (asJson) {
    console.log(JSON.stringify({ schema: 1, product: 'electromoon', cli: 'emoon', impl: 'node', version: VERSION, runtime, compatible: false }));
  } else {
    console.log(`emoon ${VERSION} (node${runtime ? `, runtime ${runtime}` : ', runtime not found'})`);
  }
}
function printHelp() {
  console.log(`emoon ${VERSION} (node reference CLI)

Usage:
  emoon init [app-dir] [--renderer <dir>] [--include <path,...>] [--api <file>] [--asset-scheme <s,...>] [--force]
  emoon inspect [app-dir] [--renderer <dir>] [--api <file>]
  emoon migrate [app-dir] [--renderer <dir>] [--api <file>] [--asset-scheme <s,...>] [--force] [--reset-data] [--dry-run]
  emoon dev [app-dir] [--api <file>] [--asset-scheme <s,...>] [--build] [--no-launch] [--runtime <path>]
  emoon bundle [app-dir] [--output <file>] [--asset-scheme <s,...>] [--build] [--dry-run] [--runtime <path>]
  emoon doctor <stage> [--profile <id>] [--runtime <path>]
  emoon run <stage> [--window] [--entry <file>] [--run-loop [--run-loop-seconds <n>]] [--menu-activate <label>] [--menu-activate-role <label>] [--runtime <path>]
  emoon version | --version
  emoon help | --help

Native runtime:
  doctor/run/dev/bundle delegate to a native emoon binary. Resolve it with
  --runtime, EMOON_RUNTIME, node_modules/electromoon/dist, dist/, _b/..., or PATH.
  Install it with:
    moon binstall f4ah6o/electromoon/cmd/emoon f4ah6o/electromoon/cmd/emoon-host@0.1.0

The Node CLI is a development reference. The native CLI is the shipped runtime.
`);
}
function run(argv) {
  const command = argv[0];
  if (!command || command === 'help' || command === '--help') { printHelp(); return 0; }
  if (command === 'version') { printVersion(true); return 0; }
  if (command === '--version') { printVersion(false); return 0; }
  if (command === 'init') return migrate.cliInit(argv.slice(1));
  if (command === 'inspect') return migrate.cliInspect(argv.slice(1));
  if (command === 'migrate') return migrate.cliMigrate(argv.slice(1));
  if (command === 'dev') return flow.dev(argv.slice(1));
  if (command === 'bundle') return flow.delegateBundle(argv.slice(1));
  if (command === 'doctor' || command === 'run') return flow.delegateCommand(argv);
  printHelp();
  return 1;
}
if (require.main === module) {
  try { process.exitCode = run(process.argv.slice(2)); }
  catch (error) {
    console.log(JSON.stringify({ ok: false, compatible: false, code: error.code || 'ELECTRON_MBT_USAGE', message: error.message }));
    process.exitCode = 1;
  }
}
module.exports = { run, VERSION };
