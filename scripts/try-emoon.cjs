#!/usr/bin/env node
'use strict';
// One-command manual trial: copy the demo app, stage it with the native CLI,
// and open a real window that stays until the human closes it.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const cli = path.join(root, 'dist/emoon');
const host = path.join(root, 'dist/emoon-host');
const fixture = path.join(root, 'fixtures/manual-demo-app');
const demo = path.join(root, '_build/manual-demo');
const stage = path.join(demo, '.emoon/app');
const argv = process.argv.slice(2);
const noLaunch = argv.includes('--no-launch');
const reset = argv.includes('--reset');
const rebuild = argv.includes('--rebuild') || !fs.existsSync(cli) || !fs.existsSync(host);

function say(message) { process.stdout.write(`${message}\n`); }
function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root, stdio: 'inherit', env: process.env, ...options,
  });
  if (result.error) {
    say(`failed to run ${command}: ${result.error.message}`);
    process.exit(1);
  }
  return result.status === null ? 1 : result.status;
}

if (!fs.existsSync(cli) || !fs.existsSync(host) || rebuild) {
  say('Building dist/emoon and dist/emoon-host ...');
  const status = run(process.execPath, [path.join(root, 'scripts/build-cli.cjs')]);
  if (status !== 0) process.exit(status);
}
if (!fs.existsSync(cli) || !fs.existsSync(host)) {
  say('dist/emoon or dist/emoon-host is still missing');
  process.exit(1);
}

if (reset && fs.existsSync(demo)) {
  fs.rmSync(demo, { recursive: true, force: true });
}
if (!fs.existsSync(demo)) {
  fs.mkdirSync(path.dirname(demo), { recursive: true });
  fs.cpSync(fixture, demo, { recursive: true });
}

say(`demo app : ${path.relative(root, demo)}`);
say(`stage    : ${path.relative(root, stage)}`);
say('');
let status = run(cli, ['init', demo, '--api', 'adapted-preload.json', '--force']);
if (status !== 0) process.exit(status);
status = run(cli, ['inspect', demo]);
if (status !== 0) process.exit(status);
status = run(cli, ['migrate', demo, '--api', 'adapted-preload.json', '--force', '--reset-data']);
if (status !== 0) process.exit(status);
status = run(cli, ['doctor', stage]);
if (status !== 0) process.exit(status);
if (noLaunch) {
  say('');
  say('Preflight only. To open the window:');
  say(`  dist/emoon run ${path.relative(root, stage)} --window --hold --entry out/main/index.js`);
  say('or re-run: node scripts/try-emoon.cjs');
  process.exit(0);
}

say('');
say('Opening a real GTK/WebKitGTK window. Close it to exit.');
say('Re-run with --reset for a fresh copy, --rebuild to rebuild the native CLI.');
say('');
status = run(cli, ['run', stage, '--window', '--hold', '--entry', 'out/main/index.js']);
process.exit(status);
