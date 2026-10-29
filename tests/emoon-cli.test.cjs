'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const flow = require('../scripts/dev-flow.cjs');

const root = path.resolve(__dirname, '..');
const cli = path.join(root, 'cmd/emoon.cjs');
const fixture = path.join(root, 'fixtures/migrate-source-app');

function temporaryApp() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'emoon-cli-'));
  fs.cpSync(fixture, directory, { recursive: true });
  return directory;
}
function run(args, cwd) {
  const result = spawnSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8', timeout: 30000 });
  const lines = `${result.stdout || ''}\n${result.stderr || ''}`.split('\n')
    .map(line => line.trim()).filter(line => line.startsWith('{') && line.endsWith('}'));
  let report = null;
  if (lines.length > 0) {
    try { report = JSON.parse(lines[lines.length - 1]); } catch { report = null; }
  }
  return { result, report, stdout: result.stdout || '', stderr: result.stderr || '' };
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

test('emoon init writes the shared .emoon config and gitignore', () => {
  const app = temporaryApp();
  try {
    const { result, report } = run(['init'], app);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(report.command, 'init');
    assert.equal(report.compatible, false);
    const config = JSON.parse(fs.readFileSync(path.join(app, '.emoon/config.json'), 'utf8'));
    assert.equal(config.main, 'out/main/index.js');
    assert.equal(config.renderer, 'out/renderer');
    assert.equal(config.page, 'out/renderer/index.html');
    assert.equal(fs.readFileSync(path.join(app, '.emoon/.gitignore'), 'utf8'), 'app/\napp.stale*/\n');
    const second = run(['init'], app);
    assert.notEqual(second.result.status, 0);
    assert.equal(second.report.code, 'ELECTRON_MBT_MIGRATE_EXISTS');
  } finally { fs.rmSync(app, { recursive: true, force: true }); }
});

test('emoon inspect reports a plain app without writing a stage', () => {
  const app = temporaryApp();
  try {
    assert.equal(run(['init'], app).result.status, 0);
    const { result, report } = run(['inspect'], app);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(report.tier, 'plain');
    assert.equal(report.compatible, false);
    assert.equal(report.claim, 'not-a-compatibility-result');
    assert.equal(report.observations.packages.includes('electron'), true);
    assert.equal(fs.existsSync(path.join(app, '.emoon/app')), false);
  } finally { fs.rmSync(app, { recursive: true, force: true }); }
});

test('emoon migrate stages the page entry and the main module', () => {
  const app = temporaryApp();
  const before = treeHash(app, item => item.startsWith('.emoon'));
  try {
    assert.equal(run(['init'], app).result.status, 0);
    const { result, report } = run(['migrate'], app);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(report.status, 'staged');
    assert.equal(report.tier, 'plain');
    assert.equal(report.adapted, null);
    assert.equal(report.compatible, false);
    const manifest = JSON.parse(fs.readFileSync(path.join(app, '.emoon/app/source-manifest.json'), 'utf8'));
    assert.equal(manifest.entry, 'out/renderer/index.html');
    assert.ok(manifest.files.some(file => file.path === 'out/main/index.js'));
    assert.ok(manifest.files.some(file => file.path === 'out/renderer/index.html'));
    assert.ok(manifest.files.some(file => file.path === 'package.json'));
    assert.equal(fs.existsSync(path.join(app, '.emoon/app/src/unused.js')), false);
    assert.equal(fs.existsSync(path.join(app, '.emoon/migration-report.json')), true);
    assert.equal(treeHash(app, item => item.startsWith('.emoon')), before);
  } finally { fs.rmSync(app, { recursive: true, force: true }); }
});

test('emoon migrate --api generates the adapter and profile in the manifest', () => {
  const app = temporaryApp();
  try {
    assert.equal(run(['init'], app).result.status, 0);
    const { result, report } = run(['migrate', '--api', 'adapted-preload.json'], app);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(report.tier, 'adapted');
    assert.deepEqual(report.adapted, { adapter: 'adapted/page-api.js' });
    const adapter = fs.readFileSync(path.join(app, '.emoon/app/adapted/page-api.js'), 'utf8');
    assert.match(adapter, /getSettings: function/);
    const profile = JSON.parse(fs.readFileSync(path.join(app, '.emoon/app/nodeless-app.json'), 'utf8'));
    assert.equal(profile.profile, 'electron-nodeless-adapted-v1');
    assert.equal(profile.adapter, 'adapted/page-api.js');
    const manifest = JSON.parse(fs.readFileSync(path.join(app, '.emoon/app/source-manifest.json'), 'utf8'));
    assert.ok(manifest.files.some(file => file.path === 'adapted/page-api.js'));
    assert.ok(manifest.files.some(file => file.path === 'nodeless-app.json'));
  } finally { fs.rmSync(app, { recursive: true, force: true }); }
});

test('emoon migrate --dry-run writes nothing and is idempotent', () => {
  const app = temporaryApp();
  try {
    assert.equal(run(['init'], app).result.status, 0);
    const dry = run(['migrate', '--dry-run'], app);
    assert.equal(dry.result.status, 0, dry.stderr);
    assert.equal(dry.report.status, 'inspected');
    assert.equal(fs.existsSync(path.join(app, '.emoon/app')), false);
    assert.equal(run(['migrate'], app).result.status, 0);
    const first = fs.readFileSync(path.join(app, '.emoon/migration-report.json'), 'utf8');
    assert.equal(run(['migrate', '--force'], app).result.status, 0);
    const second = fs.readFileSync(path.join(app, '.emoon/migration-report.json'), 'utf8');
    assert.equal(first, second);
  } finally { fs.rmSync(app, { recursive: true, force: true }); }
});

test('emoon migrate refuses a native addon and an ESM main', () => {
  const app = temporaryApp();
  try {
    fs.writeFileSync(path.join(app, 'out/renderer/native.node'), 'not-an-addon');
    assert.equal(run(['init'], app).result.status, 0);
    const blocked = run(['migrate'], app);
    assert.equal(blocked.result.status, 2);
    assert.equal(blocked.report.tier, 'blocked');
    assert.ok(blocked.report.blockers.some(item => item.code === 'ELECTRON_MBT_MIGRATE_NATIVE_ADDON'));
    assert.equal(fs.existsSync(path.join(app, '.emoon/app')), false);
  } finally { fs.rmSync(app, { recursive: true, force: true }); }

  const esm = temporaryApp();
  try {
    fs.writeFileSync(path.join(esm, 'out/main/index.mjs'), "import 'node:fs';\n");
    const pkg = JSON.parse(fs.readFileSync(path.join(esm, 'package.json'), 'utf8'));
    pkg.main = 'out/main/index.mjs';
    fs.writeFileSync(path.join(esm, 'package.json'), `${JSON.stringify(pkg, null, 2)}\n`);
    assert.equal(run(['init'], esm).result.status, 0);
    const blocked = run(['inspect'], esm);
    assert.equal(blocked.result.status, 2);
    assert.equal(blocked.report.tier, 'blocked');
    assert.ok(blocked.report.blockers.some(item => item.code === 'ELECTRON_MBT_MIGRATE_MODULE_TYPE'));
  } finally { fs.rmSync(esm, { recursive: true, force: true }); }
});

test('emoon migrate refuses to delete app data without --reset-data', () => {
  const app = temporaryApp();
  try {
    assert.equal(run(['init'], app).result.status, 0);
    assert.equal(run(['migrate'], app).result.status, 0);
    fs.mkdirSync(path.join(app, '.emoon/app/.appData'), { recursive: true });
    fs.writeFileSync(path.join(app, '.emoon/app/.appData/keep'), 'keep');
    const refused = run(['migrate', '--force'], app);
    assert.notEqual(refused.result.status, 0);
    assert.equal(refused.report.code, 'ELECTRON_MBT_MIGRATE_DATA_PRESENT');
    const reset = run(['migrate', '--force', '--reset-data'], app);
    assert.equal(reset.result.status, 0, reset.stderr);
    assert.equal(fs.existsSync(path.join(app, '.emoon/app/.appData/keep')), false);
  } finally { fs.rmSync(app, { recursive: true, force: true }); }
});

test('emoon reject an escaping renderer path', () => {
  const app = temporaryApp();
  try {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'emoon-outside-'));
    try {
      const rejected = run(['init', '--renderer', path.relative(app, outside)], app);
      assert.notEqual(rejected.result.status, 0);
      assert.equal(rejected.report.code, 'ELECTRON_MBT_PATH_ESCAPE');
    } finally { fs.rmSync(outside, { recursive: true, force: true }); }
  } finally { fs.rmSync(app, { recursive: true, force: true }); }
});

test('emoon dev --no-launch stages and runs the native doctor', {
  skip: flow.resolveRuntime({ appDir: root }) === null,
}, () => {
  const app = temporaryApp();
  try {
    const { result, report } = run(['dev', '--no-launch', '--api', 'adapted-preload.json'], app);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.equal(report.command, 'doctor');
    assert.equal(report.status, 'ready');
    assert.equal(report.profile, 'electron-nodeless-adapted-v1');
    assert.equal(report.compatible, false);
    assert.equal(fs.existsSync(path.join(app, '.emoon/app/adapted/page-api.js')), true);
  } finally { fs.rmSync(app, { recursive: true, force: true }); }
});

test('emoon version identifies the Node implementation', () => {
  const app = temporaryApp();
  try {
    const json = run(['version'], app);
    assert.equal(json.result.status, 0);
    assert.equal(json.report.impl, 'node');
    assert.equal(json.report.compatible, false);
    const text = run(['--version'], app);
    assert.equal(text.result.status, 0);
    assert.match(text.stdout, /^emoon 0\.1\.0 \(node/);
  } finally { fs.rmSync(app, { recursive: true, force: true }); }
});

test('emoon migrate --asset-scheme writes the stage field and rejects invalid names', () => {
  const app = temporaryApp();
  try {
    const init = run(['init', '--api', 'adapted-preload.json', '--asset-scheme', 'moji-asset'], app);
    assert.equal(init.result.status, 0, init.stderr);
    const config = JSON.parse(fs.readFileSync(path.join(app, '.emoon/config.json'), 'utf8'));
    assert.deepEqual(config.assetSchemes, ['moji-asset']);
    const migrate = run(['migrate', '--api', 'adapted-preload.json'], app);
    assert.equal(migrate.result.status, 0, migrate.stderr);
    const profile = JSON.parse(fs.readFileSync(path.join(app, '.emoon/app/nodeless-app.json'), 'utf8'));
    assert.deepEqual(profile.assetSchemes, ['moji-asset']);
    const bad = run(['init', '--renderer', 'out/renderer', '--asset-scheme', 'Bad', '--force'], app);
    assert.notEqual(bad.result.status, 0);
    assert.equal(bad.report.code, 'ELECTRON_MBT_PROTOCOL_INVALID_SCHEME');
  } finally { fs.rmSync(app, { recursive: true, force: true }); }
});
