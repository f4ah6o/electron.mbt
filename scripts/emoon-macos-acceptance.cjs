'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const cli = path.join(root, 'dist/emoon');
const host = path.join(root, 'dist/emoon-host');
const evidence = path.resolve(process.env.EMOON_EVIDENCE_DIR || path.join(root, 'evidence/emoon-macos'));
fs.mkdirSync(evidence, { recursive: true });
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'emoon-macos-acceptance-'));
const fakeBin = path.join(home, 'bin');
fs.mkdirSync(fakeBin);
fs.writeFileSync(path.join(fakeBin, 'node'), '#!/bin/sh\nprintf invoked >> "$EMOON_NODE_SENTINEL"\nexit 99\n', { mode: 0o755 });
const env = { ...process.env, PATH: `${fakeBin}${path.delimiter}${process.env.PATH || ''}`,
  EMOON_HOST: host, ELECTRON_MBT_TEST_MODE: '1', HOME: home,
  EMOON_NODE_SENTINEL: path.join(home, 'node-invoked'),
  XDG_DATA_HOME: path.join(home, 'data'), XDG_CACHE_HOME: path.join(home, 'cache') };
delete env.EMOON_BUNDLE_ACTIVE;
delete env.EMOON_RUNTIME;

test.after(() => fs.rmSync(home, { recursive: true, force: true }));
function execute(name, command, args, options = {}) {
  const childEnv = options.env || env;
  if (childEnv.EMOON_NODE_SENTINEL) fs.rmSync(childEnv.EMOON_NODE_SENTINEL, { force: true });
  const result = spawnSync(command, args, { cwd: options.cwd || root, env: childEnv,
    encoding: 'utf8', timeout: 120000, maxBuffer: 8 * 1024 * 1024 });
  const record = { command, args, cwd: options.cwd || root, exitCode: result.status,
    signal: result.signal, error: result.error ? result.error.message : null,
    nodeInvoked: childEnv.EMOON_NODE_SENTINEL ? fs.existsSync(childEnv.EMOON_NODE_SENTINEL) : null,
    stdout: result.stdout || '', stderr: result.stderr || '' };
  fs.writeFileSync(path.join(evidence, `${name}.json`), `${JSON.stringify(record, null, 2)}\n`);
  assert.equal(result.status, 0, `${name}: ${JSON.stringify(record)}`);
  if (childEnv.EMOON_NODE_SENTINEL) assert.equal(record.nodeInvoked, false, `${name}: unexpected Node invocation`);
  const reports = record.stdout.split('\n').flatMap(line => {
    try { return [JSON.parse(line)]; } catch { return []; }
  });
  return { record, reports, report: reports.at(-1) };
}
function verifyWindow(report, title) {
  assert.ok(report);
  assert.equal(report.status, 'PASS');
  assert.equal(report.platform, 'darwin');
  assert.equal(report.arch, 'arm64');
  assert.equal(report.windowLoaded, true);
  assert.match(report.pageTitle, title);
  assert.equal(report.rendererLoaded, true);
  assert.equal(report.renderer.apiPresent, true);
  assert.equal(report.adapted.observed, true);
  assert.ok(report.adapted.requests >= 1);
  assert.equal(report.adapted.replyErrors, 0);
  assert.equal(report.adapted.rejected, 0);
  assert.equal(report.hostShutdown, true);
  assert.equal(report.liveLeases, 0);
  assert.equal(report.nodeProcesses, 0);
  assert.equal(report.compatible, false);
}
function copied(name) {
  const dir = path.join(home, name);
  fs.cpSync(path.join(root, 'fixtures', name), dir, { recursive: true });
  return dir;
}

test('the acceptance runner uses Apple Silicon and built native binaries', () => {
  assert.equal(process.platform, 'darwin');
  assert.equal(process.arch, 'arm64');
  fs.accessSync(cli, fs.constants.X_OK);
  fs.accessSync(host, fs.constants.X_OK);
});

test('version and static doctor report the native CLI without compatibility claims', () => {
  const version = execute('version', cli, ['version']).report;
  assert.equal(version.impl, 'native');
  assert.equal(version.product, 'electromoon');
  assert.equal(version.compatible, false);
  const doctor = execute('doctor', cli, ['doctor', path.join(root, 'fixtures/nodeless-adapted-app')]).report;
  assert.equal(doctor.command, 'doctor');
  assert.equal(doctor.status, 'ready');
  assert.equal(doctor.compatible, false);
});

test('dev stages and runs a migrated adapted fixture in WKWebView', () => {
  const app = copied('migrate-source-app');
  const ready = execute('dev-no-launch', cli, ['dev', '--no-launch', '--api', 'adapted-preload.json', app]).report;
  assert.equal(ready.command, 'doctor');
  assert.equal(ready.status, 'ready');
  assert.equal(ready.compatible, false);
  const launched = execute('dev-window', cli, ['dev', '--force', '--api', 'adapted-preload.json', app]).report;
  verifyWindow(launched, /^migrate-fixture-ready$/);
});

test('run exchanges adapted requests with the real native host', () => {
  const result = execute('run-window', cli, ['run', path.join(root, 'fixtures/nodeless-adapted-app'), '--window', '--entry', 'src/main.js']);
  verifyWindow(result.report, /^nodeless-adapted-ready-module-dark-idle-(storage|no-storage)-denied-scheme$/);
  assert.equal(result.report.adapted.requests, 2);
  assert.equal(result.report.adapted.ingress.admitted, 2);
  assert.equal(result.report.adapted.ingress.denied, 0);
});

test('a fixture bundle reports metadata and launches from an isolated directory', () => {
  const output = path.join(home, 'fixture-bundle');
  const bundle = execute('bundle-fixture', cli, ['bundle', path.join(root, 'fixtures/nodeless-adapted-app'), '--output', output]).report;
  assert.equal(bundle.status, 'bundled');
  assert.equal(bundle.compatible, false);
  const info = execute('bundle-fixture-info', output, ['--bundle-info'], { cwd: home }).report;
  assert.equal(info.status, 'bundle');
  assert.equal(info.app.name, 'nodeless-adapted-fixture');
  const isolatedEnv = { ...env };
  delete isolatedEnv.EMOON_HOST;
  const launch = execute('bundle-fixture-launch', output, ['--hold', '--hold-seconds', '1'], { cwd: home, env: isolatedEnv });
  assert.ok(launch.reports.some(item => item.status === 'HOLDING'));
  assert.ok(launch.reports.some(item => item.status === 'HOLD_EXIT'));
});

test('Moji 1.0.7 boots its built renderer and bundled app', {
  skip: !process.env.EMOON_MOJI_ROOT ? 'Moji 1.0.7 built source not supplied: NOT RUN' : false,
}, () => {
  const app = path.resolve(process.env.EMOON_MOJI_ROOT);
  const pkg = JSON.parse(fs.readFileSync(path.join(app, 'package.json'), 'utf8'));
  assert.equal(pkg.name.toLowerCase(), 'moji');
  assert.equal(pkg.version, '1.0.7');
  execute('moji-capture', process.execPath, [path.join(root, 'scripts/capture-preload-api.cjs'), path.join(app, 'out/preload/preload.js'), '--name', 'api', '--out', path.join(app, 'adapted-preload.json'), '--operation', 'readPath=emoon:read-file'], { env: process.env });
  execute('moji-init', cli, ['init', app, '--api', 'adapted-preload.json', '--force']);
  const ready = execute('moji-dev', cli, ['dev', app, '--force', '--no-launch']).report;
  assert.equal(ready.status, 'ready');
  assert.equal(ready.compatible, false);
  const stage = path.join(app, '.emoon/app');
  const run = execute('moji-run', cli, ['run', stage, '--window', '--entry', 'out/main/main.js']).report;
  verifyWindow(run, /^Moji v1\.0\.7$/);
  const output = path.join(home, 'moji-bundle');
  const bundle = execute('moji-bundle', cli, ['bundle', stage, '--output', output]).report;
  assert.equal(bundle.app.version, '1.0.7');
  assert.equal(bundle.compatible, false);
  const info = execute('moji-bundle-info', output, ['--bundle-info'], { cwd: home }).report;
  assert.equal(info.app.version, '1.0.7');
  const isolatedEnv = { ...env };
  delete isolatedEnv.EMOON_HOST;
  const launch = execute('moji-bundle-launch', output, ['--hold', '--hold-seconds', '1'], { cwd: home, env: isolatedEnv });
  assert.ok(launch.reports.some(item => item.status === 'HOLDING' && item.pageTitle === 'Moji v1.0.7'));
  assert.ok(launch.reports.some(item => item.status === 'HOLD_EXIT'));
});
