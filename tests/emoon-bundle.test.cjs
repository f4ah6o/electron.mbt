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
const fixture = path.join(root, 'fixtures/nodeless-adapted-app');
const moji = path.join(root, '_build/Moji/.emoon/app');
const supported = process.platform === 'linux' && fs.existsSync(cli) && fs.existsSync(host);

function lastJson(text) {
  const lines = String(text || '').split('\n').map(line => line.trim())
    .filter(line => line.startsWith('{') && line.endsWith('}'));
  if (lines.length === 0) return null;
  try { return JSON.parse(lines[lines.length - 1]); } catch { return null; }
}
function baseEnv() {
  const env = { ...process.env };
  delete env.EMOON_HOST;
  delete env.EMOON_BUNDLE_ACTIVE;
  return env;
}
function runCli(args, env = baseEnv(), cwd = root, timeout = 45000) {
  const result = spawnSync(cli, args, { cwd, env, encoding: 'utf8', timeout });
  return { result, report: lastJson(`${result.stdout || ''}\n${result.stderr || ''}`) };
}
function bundle(stage, output, extra = []) {
  return runCli(['bundle', stage, '--output', output, ...extra]);
}
function runtimeEnv(home) {
  return {
    ...baseEnv(),
    XDG_DATA_HOME: path.join(home, 'data'),
    XDG_CACHE_HOME: path.join(home, 'cache'),
  };
}
function runBundle(binary, home, args = ['--hold', '--hold-seconds', '1']) {
  return spawnSync(binary, args, {
    cwd: home,
    env: runtimeEnv(home),
    encoding: 'utf8',
    timeout: 45000,
  });
}
function temporaryHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'emoon-bundle-home-'));
}

test('bundle produces one ELF and reports metadata', { skip: !supported }, () => {
  const home = temporaryHome();
  try {
    const output = path.join(home, 'fixture-bundle');
    const result = bundle(fixture, output);
    assert.equal(result.result.status, 0, result.result.stderr);
    assert.equal(result.report.status, 'bundled');
    assert.equal(result.report.format, 'emoon-single-v1');
    assert.equal(result.report.compression, 'zlib');
    assert.equal(result.report.app.name, 'nodeless-adapted-fixture');
    assert.equal(result.report.compatible, false);
    assert.equal(fs.statSync(output).mode & 0o111, 0o111);
    assert.ok(result.report.bytes > result.report.storedBytes);
    const info = spawnSync(output, ['--bundle-info'], { encoding: 'utf8', timeout: 20000 });
    assert.equal(info.status, 0, info.stderr);
    const infoReport = JSON.parse(String(info.stdout).trim());
    assert.equal(infoReport.status, 'bundle');
    assert.equal(infoReport.app.name, 'nodeless-adapted-fixture');
    assert.equal(infoReport.bytes, result.report.bytes);
    assert.equal(infoReport.storedBytes, result.report.storedBytes);
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test('bundle runs without an adjacent host or app and preserves app data', { skip: !supported }, () => {
  const home = temporaryHome();
  try {
    const output = path.join(home, 'fixture-bundle');
    assert.equal(bundle(fixture, output).result.status, 0);
    const first = runBundle(output, home);
    assert.equal(first.status, 0, first.stderr);
    assert.match(first.stdout, /"status":"HOLDING"/);
    assert.match(first.stdout, /"profile":"electron-nodeless-adapted-v1"/);
    const appHome = path.join(home, 'data/electromoon/apps/nodeless-adapted-fixture');
    const sentinel = path.join(appHome, 'app/.appData/sentinel');
    fs.mkdirSync(path.dirname(sentinel), { recursive: true });
    fs.writeFileSync(sentinel, 'keep\n');
    const second = runBundle(output, home);
    assert.equal(second.status, 0, second.stderr);
    assert.equal(fs.readFileSync(sentinel, 'utf8'), 'keep\n');
    assert.ok(fs.existsSync(path.join(home, 'cache/electromoon/hosts')));
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test('bundle refuses existing output, missing stage and corrupt payload', { skip: !supported }, () => {
  const home = temporaryHome();
  try {
    const output = path.join(home, 'fixture-bundle');
    assert.equal(bundle(fixture, output).result.status, 0);
    const duplicate = bundle(fixture, output);
    assert.notEqual(duplicate.result.status, 0);
    assert.equal(duplicate.report.code, 'ELECTRON_MBT_BUNDLE_EXISTS');
    assert.equal(bundle(fixture, output, ['--force']).result.status, 0);
    const missing = bundle(path.join(fixture, 'src'), path.join(home, 'missing'));
    assert.notEqual(missing.result.status, 0);
    assert.equal(missing.report.code, 'ELECTRON_MBT_BUNDLE_INPUT');
    const corrupt = path.join(home, 'corrupt');
    fs.copyFileSync(output, corrupt);
    const payloadOffset = fs.statSync(cli).size + 100;
    const fd = fs.openSync(corrupt, 'r+');
    const byte = Buffer.alloc(1);
    fs.readSync(fd, byte, 0, 1, payloadOffset);
    byte[0] ^= 0xff;
    fs.writeSync(fd, byte, 0, 1, payloadOffset);
    fs.closeSync(fd);
    const broken = runBundle(corrupt, home);
    assert.equal(broken.status, 1);
    assert.match(broken.stdout, /ELECTRON_MBT_BUNDLE_CORRUPT/);
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test('Moji 1.0.7 can be bundled below the lightweight size target', {
  skip: !supported || !fs.existsSync(moji) || fs.statSync(cli).size > 4 * 1024 * 1024,
}, () => {
  const home = temporaryHome();
  try {
    const output = path.join(home, 'Moji-1.0.7-linux-x86_64');
    const result = bundle(moji, output);
    assert.equal(result.result.status, 0, result.result.stderr);
    assert.equal(result.report.app.name, 'moji');
    assert.equal(result.report.app.version, '1.0.7');
    assert.ok(fs.statSync(output).size <= 8 * 1024 * 1024,
      `bundle is ${fs.statSync(output).size} bytes`);
    const run = runBundle(output, home, ['--hold', '--hold-seconds', '1']);
    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stdout, /"pageTitle":"Moji v1\.0\.7"/);
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test('bundle rejects symlinks in the stage and at the output', { skip: !supported }, () => {
  const home = temporaryHome();
  try {
    const stage = path.join(home, 'stage');
    fs.cpSync(fixture, stage, { recursive: true });
    fs.symlinkSync('/etc/passwd', path.join(stage, 'escape'));
    const rejected = bundle(stage, path.join(home, 'escape-bundle'));
    assert.notEqual(rejected.result.status, 0);
    assert.match(`${rejected.result.stdout}${rejected.result.stderr}`, /BUNDLE_STAGE/);
    const output = path.join(home, 'ok-bundle');
    assert.equal(bundle(fixture, output).result.status, 0);
    const linked = path.join(home, 'linked-bundle');
    fs.symlinkSync(output, linked);
    const linkedResult = bundle(fixture, linked, ['--force']);
    assert.notEqual(linkedResult.result.status, 0);
    assert.equal(linkedResult.report.code, 'ELECTRON_MBT_BUNDLE_OUTPUT');
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});
