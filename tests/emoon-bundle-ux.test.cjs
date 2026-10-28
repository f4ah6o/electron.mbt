'use strict';
// One-command `emoon bundle` UX: stage-if-needed, default output, dry-run,
// source-staleness, app-data refusal, host resolution and the Node delegation.
// Linux only; the single executable still needs system GTK 3/WebKitGTK 4.1.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const cli = path.join(root, 'dist/emoon');
const host = path.join(root, 'dist/emoon-host');
const nodeCli = path.join(root, 'cmd/emoon.cjs');

function helpHasBundleUx() {
  try {
    const result = spawnSync(cli, ['bundle', '--help'], { encoding: 'utf8', timeout: 15000 });
    return result.status === 0 && String(result.stdout).includes('--dry-run');
  } catch { return false; }
}
const supported = process.platform === 'linux' && fs.existsSync(cli) &&
  fs.existsSync(host) && helpHasBundleUx();

function lastJson(text) {
  const lines = String(text || '').split('\n').map(line => line.trim())
    .filter(line => line.startsWith('{') && line.endsWith('}'));
  if (lines.length === 0) return null;
  try { return JSON.parse(lines[lines.length - 1]); } catch { return null; }
}
function baseEnv(extra = {}) {
  const env = { ...process.env, ...extra };
  delete env.EMOON_HOST;
  delete env.EMOON_BUNDLE_ACTIVE;
  delete env.EMOON_RUNTIME;
  return env;
}
function runCli(args, cwd, extraEnv = {}, timeout = 120000) {
  const result = spawnSync(cli, args, {
    cwd, env: baseEnv(extraEnv), encoding: 'utf8', timeout,
  });
  return {
    result,
    report: lastJson(`${result.stdout || ''}\n${result.stderr || ''}`),
    stdout: result.stdout || '',
    stderr: result.stderr || '',
  };
}
function temporaryApp(name = 'migrate-source-app') {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'emoon-bundle-ux-'));
  fs.cpSync(path.join(root, 'fixtures', name), directory, { recursive: true });
  return directory;
}
function temporaryHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'emoon-bundle-home-'));
}
function cleanup(directory) {
  fs.rmSync(directory, { recursive: true, force: true });
}
function treeHash(directory, skip) {
  const hash = crypto.createHash('sha256');
  const walk = (current, relative) => {
    for (const name of fs.readdirSync(current).sort()) {
      const absolute = path.join(current, name);
      const item = relative ? `${relative}/${name}` : name;
      if (skip && skip(item)) continue;
      const info = fs.lstatSync(absolute);
      if (info.isDirectory()) walk(absolute, item);
      else if (info.isFile()) hash.update(item).update('\0').update(fs.readFileSync(absolute)).update('\0');
    }
  };
  walk(directory, '');
  return hash.digest('hex');
}
function bundleRun(binary, home) {
  return spawnSync(binary, ['--hold', '--hold-seconds', '1'], {
    cwd: home,
    env: baseEnv({
      XDG_DATA_HOME: path.join(home, 'data'),
      XDG_CACHE_HOME: path.join(home, 'cache'),
    }),
    encoding: 'utf8',
    timeout: 60000,
  });
}
function stageClone(app) {
  return path.join(app, '.emoon/app');
}

test('one command stages and bundles a built app', { skip: !supported }, () => {
  const app = temporaryApp();
  const home = temporaryHome();
  try {
    const before = treeHash(app, item => item === '.emoon' || item.startsWith('.emoon/'));
    const first = runCli(['bundle', '--api', 'adapted-preload.json'], app);
    assert.equal(first.result.status, 0, `${first.stdout}\n${first.stderr}`);
    assert.equal(first.report.status, 'bundled');
    assert.equal(first.report.command, 'bundle');
    assert.equal(first.report.stage.mode, 'staged');
    assert.equal(first.report.replaced, false);
    assert.equal(first.report.compatible, false);
    assert.match(first.report.output, /\.emoon\/dist\/migrate-fixture-1\.0\.0-linux-x64$/);
    assert.equal(first.stdout.trim().split('\n').length, 1, first.stdout);
    assert.ok(fs.existsSync(path.join(app, '.emoon/config.json')));
    assert.ok(fs.existsSync(path.join(stageClone(app), 'source-manifest.json')));
    assert.equal(fs.readFileSync(path.join(app, '.emoon/dist/.gitignore'), 'utf8'), '*\n');
    assert.equal(fs.statSync(first.report.output).mode & 0o111, 0o111);
    const after = treeHash(app, item => item === '.emoon' || item.startsWith('.emoon/'));
    assert.equal(after, before, 'bundle changed the app source');
    const info = spawnSync(first.report.output, ['--bundle-info'], { encoding: 'utf8', timeout: 30000 });
    assert.equal(info.status, 0, info.stderr);
    assert.equal(JSON.parse(String(info.stdout).trim()).app.name, 'migrate-fixture');
    const run = bundleRun(first.report.output, home);
    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stdout, /"status":"HOLDING"/);
    assert.match(run.stdout, /"pageTitle":"migrate-fixture-ready"/);
  } finally {
    cleanup(app);
    cleanup(home);
  }
});

test('the default output is replaced and a valid stage is reused', { skip: !supported }, () => {
  const app = temporaryApp();
  try {
    const first = runCli(['bundle', '--api', 'adapted-preload.json'], app);
    assert.equal(first.result.status, 0, first.stderr);
    const manifest = path.join(stageClone(app), 'source-manifest.json');
    const before = fs.statSync(manifest).mtimeMs;
    const second = runCli(['bundle', '--api', 'adapted-preload.json'], app);
    assert.equal(second.result.status, 0, second.stderr);
    assert.equal(second.report.stage.mode, 'reused');
    assert.equal(second.report.replaced, true);
    assert.equal(second.report.output, first.report.output);
    assert.equal(fs.statSync(manifest).mtimeMs, before);
  } finally { cleanup(app); }
});

test('a source change re-stages and updates the payload hash', { skip: !supported }, () => {
  const app = temporaryApp();
  try {
    const first = runCli(['bundle', '--api', 'adapted-preload.json'], app);
    assert.equal(first.result.status, 0, first.stderr);
    fs.appendFileSync(path.join(app, 'out/renderer/app.js'), '\n// source change\n');
    const second = runCli(['bundle', '--api', 'adapted-preload.json'], app);
    assert.equal(second.result.status, 0, second.stderr);
    assert.equal(second.report.stage.mode, 'staged');
    assert.notEqual(second.report.sha256, first.report.sha256);
  } finally { cleanup(app); }
});

test('stale restage never deletes app data without --reset-data', { skip: !supported }, () => {
  const app = temporaryApp();
  try {
    assert.equal(runCli(['bundle', '--api', 'adapted-preload.json'], app).result.status, 0);
    const sentinel = path.join(stageClone(app), '.appData/sentinel');
    fs.mkdirSync(path.dirname(sentinel), { recursive: true });
    fs.writeFileSync(sentinel, 'keep\n');
    fs.appendFileSync(path.join(app, 'out/renderer/app.js'), '\n// data change\n');
    const refused = runCli(['bundle', '--api', 'adapted-preload.json'], app);
    assert.equal(refused.result.status, 1);
    assert.equal(refused.report.code, 'ELECTRON_MBT_BUNDLE_STALE');
    assert.match(refused.report.hint, /--reset-data/);
    assert.equal(fs.readFileSync(sentinel, 'utf8'), 'keep\n');
    const reset = runCli(['bundle', '--api', 'adapted-preload.json', '--reset-data'], app);
    assert.equal(reset.result.status, 0, reset.stderr);
    assert.equal(fs.existsSync(sentinel), false);
  } finally { cleanup(app); }
});

test('--no-stage refuses a missing or stale stage without writing', { skip: !supported }, () => {
  const app = temporaryApp();
  try {
    const missing = runCli(['bundle', '--api', 'adapted-preload.json', '--no-stage'], app);
    assert.equal(missing.result.status, 1);
    assert.equal(missing.report.code, 'ELECTRON_MBT_BUNDLE_STAGE');
    assert.equal(fs.existsSync(path.join(app, '.emoon')), false);
    assert.equal(runCli(['bundle', '--api', 'adapted-preload.json'], app).result.status, 0);
    fs.appendFileSync(path.join(app, 'out/renderer/app.js'), '\n// stale\n');
    const stale = runCli(['bundle', '--api', 'adapted-preload.json', '--no-stage'], app);
    assert.equal(stale.result.status, 1);
    assert.equal(stale.report.code, 'ELECTRON_MBT_BUNDLE_STALE');
  } finally { cleanup(app); }
});

test('--dry-run writes nothing and reports the plan', { skip: !supported }, () => {
  const app = temporaryApp();
  try {
    const planned = runCli(['bundle', '--api', 'adapted-preload.json', '--dry-run'], app);
    assert.equal(planned.result.status, 0, planned.stderr);
    assert.equal(planned.report.status, 'planned');
    assert.equal(planned.report.stage.state, 'missing');
    assert.deepEqual(planned.report.actions, ['init', 'stage', 'bundle']);
    assert.match(planned.report.output, /\.emoon\/dist\/migrate-fixture-1\.0\.0-linux-x64$/);
    assert.equal(fs.existsSync(path.join(app, '.emoon')), false);
    assert.equal(runCli(['bundle', '--api', 'adapted-preload.json'], app).result.status, 0);
    const ready = runCli(['bundle', '--api', 'adapted-preload.json', '--dry-run'], app);
    assert.equal(ready.report.stage.state, 'ready');
    assert.deepEqual(ready.report.actions, ['bundle']);
    assert.equal(ready.report.replaceOutput, true);
  } finally { cleanup(app); }
});

test('--build builds an unbuilt app before staging', { skip: !supported }, () => {
  const app = temporaryApp('migrate-unbuilt-app');
  try {
    fs.copyFileSync(
      path.join(root, 'fixtures/migrate-source-app/adapted-preload.json'),
      path.join(app, 'adapted-preload.json'),
    );
    const missing = runCli(['bundle', '--api', 'adapted-preload.json'], app);
    assert.equal(missing.result.status, 1);
    assert.equal(missing.report.code, 'ELECTRON_MBT_BUNDLE_BUILD_MISSING');
    assert.match(missing.report.hint, /--build/);
    fs.mkdirSync(path.join(app, 'node_modules'), { recursive: true });
    const built = runCli(['bundle', '--build', '--api', 'adapted-preload.json'], app);
    assert.equal(built.result.status, 0, `${built.stdout}\n${built.stderr}`);
    assert.equal(built.report.stage.mode, 'staged');
    assert.ok(fs.existsSync(path.join(app, 'out/main/index.js')));
    assert.ok(fs.existsSync(built.report.output));
  } finally { cleanup(app); }
});

test('a plain stage explains the adapted-profile --api option', { skip: !supported }, () => {
  const app = temporaryApp();
  try {
    const plain = runCli(['bundle'], app);
    assert.equal(plain.result.status, 1);
    assert.equal(plain.report.code, 'ELECTRON_MBT_BUNDLE_STAGE');
    assert.match(plain.report.message, /--api/);
  } finally { cleanup(app); }
});

test('host resolution explains the lookup and accepts PATH or --host', { skip: !supported }, () => {
  const app = temporaryApp();
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'emoon-bundle-bin-'));
  const hostDir = fs.mkdtempSync(path.join(os.tmpdir(), 'emoon-bundle-host-'));
  try {
    assert.equal(runCli(['bundle', '--api', 'adapted-preload.json'], app).result.status, 0);
    const isolated = path.join(bin, 'emoon');
    fs.copyFileSync(cli, isolated);
    fs.chmodSync(isolated, 0o755);
    const noHost = spawnSync(isolated, ['bundle', '--api', 'adapted-preload.json', '--dry-run'], {
      cwd: app,
      env: baseEnv({ PATH: '/usr/bin:/bin' }),
      encoding: 'utf8',
      timeout: 60000,
    });
    assert.equal(noHost.status, 1, noHost.stdout);
    assert.equal(lastJson(noHost.stdout).code, 'ELECTRON_MBT_BUNDLE_HOST');
    assert.match(lastJson(noHost.stdout).hint, /--host/);
    fs.copyFileSync(host, path.join(hostDir, 'emoon-host'));
    fs.chmodSync(path.join(hostDir, 'emoon-host'), 0o755);
    const viaPath = spawnSync(isolated, ['bundle', '--api', 'adapted-preload.json', '--dry-run'], {
      cwd: app,
      env: baseEnv({ PATH: hostDir }),
      encoding: 'utf8',
      timeout: 60000,
    });
    assert.equal(viaPath.status, 0, viaPath.stderr);
    assert.equal(lastJson(viaPath.stdout).host.path, path.join(hostDir, 'emoon-host'));
    const viaFlag = runCli(
      ['bundle', '--api', 'adapted-preload.json', '--dry-run', '--host', host],
      app,
      { PATH: '/usr/bin:/bin' },
    );
    assert.equal(viaFlag.result.status, 0, viaFlag.stderr);
    assert.equal(viaFlag.report.host.path, host);
  } finally {
    cleanup(app);
    cleanup(bin);
    cleanup(hostDir);
  }
});

test('explicit output keeps --force semantics and default naming is sanitized', { skip: !supported }, () => {
  const app = temporaryApp();
  try {
    const pkgPath = path.join(app, 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    pkg.name = '@scope/app';
    pkg.version = '2.0.0-beta.1';
    fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
    assert.equal(runCli(['bundle', '--api', 'adapted-preload.json'], app).result.status, 0);
    const planned = runCli(['bundle', '--api', 'adapted-preload.json', '--dry-run'], app);
    assert.match(planned.report.output, /scope-app-2\.0\.0-beta\.1-linux-x64$/);
    const named = runCli(
      ['bundle', '--api', 'adapted-preload.json', '--dry-run', '--name', 'My App'],
      app,
    );
    assert.match(named.report.output, /my-app-2\.0\.0-beta\.1-linux-x64$/);
    const explicit = path.join(app, 'explicit-bundle');
    fs.writeFileSync(explicit, 'occupied\n');
    const refused = runCli(
      ['bundle', '--api', 'adapted-preload.json', '--output', explicit],
      app,
    );
    assert.equal(refused.result.status, 1);
    assert.equal(refused.report.code, 'ELECTRON_MBT_BUNDLE_EXISTS');
    const forced = runCli(
      ['bundle', '--api', 'adapted-preload.json', '--output', explicit, '--force'],
      app,
    );
    assert.equal(forced.result.status, 0, forced.stderr);
    assert.equal(fs.statSync(explicit).mode & 0o111, 0o111);
    const badName = runCli(['bundle', '--api', 'adapted-preload.json', '--name', '..'], app);
    assert.equal(badName.result.status, 1);
    assert.equal(badName.report.code, 'ELECTRON_MBT_BUNDLE_APP');
    const stageOnly = runCli(['bundle', '.emoon/app'], app);
    assert.equal(stageOnly.result.status, 1);
    assert.equal(stageOnly.report.code, 'ELECTRON_MBT_BUNDLE_USAGE');
  } finally { cleanup(app); }
});

test('the Node reference delegates bundle to the native CLI', { skip: !supported }, () => {
  const app = temporaryApp();
  try {
    const result = spawnSync(
      process.execPath,
      [nodeCli, 'bundle', '--api', 'adapted-preload.json', '--dry-run', '--runtime', cli],
      { cwd: app, env: baseEnv(), encoding: 'utf8', timeout: 60000 },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.equal(lastJson(result.stdout).status, 'planned');
    assert.equal(lastJson(result.stdout).command, 'bundle');
  } finally { cleanup(app); }
});

test('help and the bare invocation make the next command discoverable', { skip: !supported }, () => {
  const app = temporaryApp();
  try {
    const help = spawnSync(cli, ['bundle', '--help'], { encoding: 'utf8', timeout: 15000 });
    assert.equal(help.status, 0);
    assert.match(help.stdout, /--dry-run/);
    assert.match(help.stdout, /\.emoon\/dist/);
    const bare = spawnSync(cli, [], { cwd: app, env: baseEnv(), encoding: 'utf8', timeout: 15000 });
    assert.equal(bare.status, 1);
    assert.match(bare.stderr, /next: emoon bundle/);
  } finally { cleanup(app); }
});
