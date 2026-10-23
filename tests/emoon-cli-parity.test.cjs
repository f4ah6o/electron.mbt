'use strict';
// Native `emoon` parity against the Node reference CLI. Both implementations
// run on separate copies of the same app; stage trees, generated files and
// reports are compared. This is a developer-tool parity suite, not a
// compatibility result.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const nodeCli = path.join(root, 'cmd/emoon.cjs');
const fixture = path.join(root, 'fixtures/migrate-source-app');
const binaryCandidates = [
  path.join(root, '_build/native/debug/build/cmd/emoon/emoon.exe'),
  path.join(root, '_build/native/debug/build/cmd/emoon/emoon'),
  path.join(root, '_build/native/release/build/cmd/emoon/emoon.exe'),
  path.join(root, '_build/native/release/build/cmd/emoon/emoon'),
];
const hostBinary = path.join(root, 'dist/emoon-host');

function nativeBinary() {
  const build = spawnSync('moon', ['build', '--target', 'native', 'cmd/emoon'], {
    cwd: root, encoding: 'utf8', timeout: 240000,
  });
  assert.equal(build.status, 0, `moon build failed\n${build.stdout}\n${build.stderr}`);
  const binary = binaryCandidates.find(candidate => fs.existsSync(candidate));
  assert.ok(binary, 'native emoon binary was not produced');
  return binary;
}
let binary = null;
function nativeCli() {
  if (!binary) binary = nativeBinary();
  return binary;
}
function temporaryApp() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'emoon-parity-'));
  fs.cpSync(fixture, directory, { recursive: true });
  return directory;
}
function run(command, args, cwd, extraEnv = {}) {
  const result = spawnSync(command, args, {
    cwd, encoding: 'utf8', timeout: 120000,
    env: { ...process.env, ...extraEnv },
  });
  const lines = `${result.stdout || ''}\n${result.stderr || ''}`.split('\n')
    .map(line => line.trim()).filter(line => line.startsWith('{') && line.endsWith('}'));
  const reports = [];
  for (const line of lines) {
    try { reports.push(JSON.parse(line)); } catch { /* diagnostics */ }
  }
  return { result, reports, report: reports.length > 0 ? reports[reports.length - 1] : null,
    stdout: result.stdout || '', stderr: result.stderr || '' };
}
function runNative(args, app, extraEnv = {}) {
  return run(nativeCli(), args, root, extraEnv);
}
function runNode(args, app, extraEnv = {}) {
  return run(process.execPath, [nodeCli, ...args], root, extraEnv);
}
function hash(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}
function normalize(value, appDir) {
  if (value === null || value === undefined) return value;
  let text = JSON.stringify(value);
  text = text.split(appDir).join('<app>');
  text = text.replace(/"impl":"(?:node|native)"/g, '"impl":"<impl>"');
  return JSON.parse(text);
}
function tree(dir) {
  const entries = new Map();
  if (!fs.existsSync(dir)) return entries;
  const walk = (current, relative) => {
    for (const name of fs.readdirSync(current).sort()) {
      const absolute = path.join(current, name);
      const item = relative ? `${relative}/${name}` : name;
      const info = fs.lstatSync(absolute);
      if (info.isDirectory()) walk(absolute, item);
      else if (info.isFile()) {
        entries.set(item, { sha256: hash(fs.readFileSync(absolute)), mode: info.mode & 0o777, bytes: info.size });
      } else {
        entries.set(item, { link: fs.readlinkSync(absolute) });
      }
    }
  };
  walk(dir, '');
  return entries;
}
function compareReports(native, node, app, label) {
  assert.equal(native.result.status, node.result.status, `${label}: exit status\n${native.stdout}\n${native.stderr}`);
  assert.ok(native.report, `${label}: native report missing\n${native.stdout}\n${native.stderr}`);
  assert.ok(node.report, `${label}: node report missing\n${node.stdout}\n${node.stderr}`);
  assert.deepEqual(normalize(native.report, app.native), normalize(node.report, app.node), label);
}
function pair() {
  return { native: temporaryApp(), node: temporaryApp() };
}
function cleanup(app) {
  fs.rmSync(app.native, { recursive: true, force: true });
  fs.rmSync(app.node, { recursive: true, force: true });
}

test('native init matches the reference config and report', () => {
  const app = pair();
  try {
    const native = runNative(['init', app.native], app.native);
    const node = runNode(['init', app.node], app.node);
    compareReports(native, node, app, 'init');
    assert.equal(
      fs.readFileSync(path.join(app.native, '.emoon/config.json'), 'utf8'),
      fs.readFileSync(path.join(app.node, '.emoon/config.json'), 'utf8'),
    );
    assert.equal(
      fs.readFileSync(path.join(app.native, '.emoon/.gitignore'), 'utf8'),
      fs.readFileSync(path.join(app.node, '.emoon/.gitignore'), 'utf8'),
    );
    const second = runNative(['init', app.native], app.native);
    assert.notEqual(second.result.status, 0);
    assert.equal(second.report.code, 'ELECTRON_MBT_MIGRATE_EXISTS');
  } finally { cleanup(app); }
});

test('native init honours explicit renderer, include and api flags', () => {
  const app = pair();
  try {
    const args = ['init', 'APP', '--renderer', 'out/renderer', '--include', 'src/unused.js', '--api', 'adapted-preload.json'];
    const native = runNative([...args.slice(0, 1), app.native, ...args.slice(2)], app.native);
    const node = runNode([...args.slice(0, 1), app.node, ...args.slice(2)], app.node);
    compareReports(native, node, app, 'init flags');
    assert.equal(
      fs.readFileSync(path.join(app.native, '.emoon/config.json'), 'utf8'),
      fs.readFileSync(path.join(app.node, '.emoon/config.json'), 'utf8'),
    );
  } finally { cleanup(app); }
});

test('native inspect matches the plain and adapted reference reports', () => {
  const app = pair();
  try {
    assert.equal(runNative(['init', app.native], app.native).result.status, 0);
    assert.equal(runNode(['init', app.node], app.node).result.status, 0);
    const plainNative = runNative(['inspect', app.native], app.native);
    const plainNode = runNode(['inspect', app.node], app.node);
    compareReports(plainNative, plainNode, app, 'inspect plain');
    assert.equal(plainNative.report.tier, 'plain');
    const adaptedNative = runNative(['inspect', app.native, '--api', 'adapted-preload.json'], app.native);
    const adaptedNode = runNode(['inspect', app.node, '--api', 'adapted-preload.json'], app.node);
    compareReports(adaptedNative, adaptedNode, app, 'inspect adapted');
    assert.equal(adaptedNative.report.tier, 'adapted');
    assert.equal(fs.existsSync(path.join(app.native, '.emoon/app')), false);
  } finally { cleanup(app); }
});

test('native inspect and migrate fail closed for a native addon and an ESM main', () => {
  const app = pair();
  try {
    for (const target of [app.native, app.node]) {
      fs.writeFileSync(path.join(target, 'out/renderer/native.node'), 'not-an-addon');
    }
    for (const target of [app.native, app.node]) {
      assert.equal(runNode(['init', target], target).result.status, 0);
    }
    const addonNative = runNative(['inspect', app.native], app.native);
    const addonNode = runNode(['inspect', app.node], app.node);
    compareReports(addonNative, addonNode, app, 'inspect addon');
    assert.equal(addonNative.result.status, 2);
    const blockedNative = runNative(['migrate', app.native], app.native);
    const blockedNode = runNode(['migrate', app.node], app.node);
    compareReports(blockedNative, blockedNode, app, 'migrate addon');
    assert.equal(blockedNative.result.status, 2);
    assert.equal(fs.existsSync(path.join(app.native, '.emoon/app')), false);

    for (const target of [app.native, app.node]) {
      const pkg = JSON.parse(fs.readFileSync(path.join(target, 'package.json'), 'utf8'));
      pkg.main = 'out/main/index.mjs';
      fs.writeFileSync(path.join(target, 'package.json'), `${JSON.stringify(pkg, null, 2)}\n`);
      fs.writeFileSync(path.join(target, 'out/main/index.mjs'), "import 'node:fs';\n");
    }
    const esmNative = runNative(['inspect', app.native], app.native);
    const esmNode = runNode(['inspect', app.node], app.node);
    compareReports(esmNative, esmNode, app, 'inspect esm');
    assert.equal(esmNative.result.status, 2);
  } finally { cleanup(app); }
});

test('native migrate stages a byte-identical plain tree', () => {
  const app = pair();
  try {
    for (const target of [app.native, app.node]) {
      assert.equal(runNative(['init', target], target).result.status, 0);
    }
    const native = runNative(['migrate', app.native], app.native);
    const node = runNode(['migrate', app.node], app.node);
    compareReports(native, node, app, 'migrate plain');
    assert.deepEqual(tree(path.join(app.native, '.emoon/app')), tree(path.join(app.node, '.emoon/app')));
    assert.equal(
      fs.readFileSync(path.join(app.native, '.emoon/app/source-manifest.json'), 'utf8'),
      fs.readFileSync(path.join(app.node, '.emoon/app/source-manifest.json'), 'utf8'),
    );
    assert.equal(
      fs.readFileSync(path.join(app.native, '.emoon/migration-report.json'), 'utf8'),
      fs.readFileSync(path.join(app.node, '.emoon/migration-report.json'), 'utf8')
        .replace('"impl": "node"', '"impl": "native"')
        .replaceAll(app.node, app.native),
    );
  } finally { cleanup(app); }
});

test('native migrate generates a byte-identical adapted adapter', () => {
  const app = pair();
  try {
    for (const target of [app.native, app.node]) {
      assert.equal(runNative(['init', target], target).result.status, 0);
    }
    const native = runNative(['migrate', app.native, '--api', 'adapted-preload.json'], app.native);
    const node = runNode(['migrate', app.node, '--api', 'adapted-preload.json'], app.node);
    compareReports(native, node, app, 'migrate adapted');
    assert.deepEqual(tree(path.join(app.native, '.emoon/app')), tree(path.join(app.node, '.emoon/app')));
    assert.equal(
      hash(fs.readFileSync(path.join(app.native, '.emoon/app/adapted/page-api.js'))),
      hash(fs.readFileSync(path.join(app.node, '.emoon/app/adapted/page-api.js'))),
    );
    const profileNative = JSON.parse(fs.readFileSync(path.join(app.native, '.emoon/app/nodeless-app.json'), 'utf8'));
    const profileNode = JSON.parse(fs.readFileSync(path.join(app.node, '.emoon/app/nodeless-app.json'), 'utf8'));
    assert.deepEqual(profileNative, profileNode);
  } finally { cleanup(app); }
});

test('native migrate dry-run writes nothing and matches the reference', () => {
  const app = pair();
  try {
    for (const target of [app.native, app.node]) {
      assert.equal(runNative(['init', target], target).result.status, 0);
    }
    const native = runNative(['migrate', '--dry-run', app.native], app.native);
    const node = runNode(['migrate', '--dry-run', app.node], app.node);
    compareReports(native, node, app, 'migrate dry-run');
    assert.equal(fs.existsSync(path.join(app.native, '.emoon/app')), false);
    assert.equal(native.report.status, 'inspected');
  } finally { cleanup(app); }
});

test('native migrate is idempotent and refuses app data without --reset-data', () => {
  const app = pair();
  try {
    for (const target of [app.native, app.node]) {
      assert.equal(runNative(['init', target], target).result.status, 0);
    }
    assert.equal(runNative(['migrate', app.native], app.native).result.status, 0);
    assert.equal(runNode(['migrate', app.node], app.node).result.status, 0);
    const first = fs.readFileSync(path.join(app.native, '.emoon/migration-report.json'), 'utf8');
    assert.equal(runNative(['migrate', '--force', app.native], app.native).result.status, 0);
    const second = fs.readFileSync(path.join(app.native, '.emoon/migration-report.json'), 'utf8');
    assert.equal(first, second);
    for (const target of [app.native, app.node]) {
      fs.mkdirSync(path.join(target, '.emoon/app/.appData'), { recursive: true });
      fs.writeFileSync(path.join(target, '.emoon/app/.appData/keep'), 'keep');
    }
    const refusedNative = runNative(['migrate', '--force', app.native], app.native);
    const refusedNode = runNode(['migrate', '--force', app.node], app.node);
    compareReports(refusedNative, refusedNode, app, 'migrate data refusal');
    const reset = runNative(['migrate', '--force', '--reset-data', app.native], app.native);
    assert.equal(reset.result.status, 0, reset.stderr);
    assert.equal(fs.existsSync(path.join(app.native, '.emoon/app/.appData/keep')), false);
  } finally { cleanup(app); }
});

test('native migrate ignores node_modules/.cache and matches the reference', () => {
  const app = pair();
  try {
    for (const target of [app.native, app.node]) {
      fs.mkdirSync(path.join(target, 'out/renderer/node_modules/.cache'), { recursive: true });
      fs.writeFileSync(path.join(target, 'out/renderer/node_modules/.cache/junk.js'), "require('cache-only');\n");
      assert.equal(runNative(['init', target], target).result.status, 0);
    }
    const native = runNative(['migrate', app.native], app.native);
    const node = runNode(['migrate', app.node], app.node);
    compareReports(native, node, app, 'migrate cache');
    assert.equal(fs.existsSync(path.join(app.native, '.emoon/app/out/renderer/node_modules/.cache/junk.js')), false);
    assert.equal(fs.existsSync(path.join(app.node, '.emoon/app/out/renderer/node_modules/.cache/junk.js')), false);
  } finally { cleanup(app); }
});

test('native and reference reject symlinks, path escape and missing entries alike', () => {
  const app = pair();
  try {
    for (const target of [app.native, app.node]) {
      assert.equal(runNative(['init', target], target).result.status, 0);
      fs.symlinkSync('index.html', path.join(target, 'out/renderer/link.html'));
    }
    const symlinkNative = runNative(['inspect', app.native], app.native);
    const symlinkNode = runNode(['inspect', app.node], app.node);
    compareReports(symlinkNative, symlinkNode, app, 'inspect symlink');
    assert.equal(symlinkNative.result.status, 1);
    assert.equal(symlinkNative.report.code, 'ELECTRON_MBT_MIGRATE_SYMLINK');

    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'emoon-parity-outside-'));
    try {
      const escapeNative = runNative(['init', app.native, '--renderer', path.relative(app.native, outside)], app.native);
      const escapeNode = runNode(['init', app.node, '--renderer', path.relative(app.node, outside)], app.node);
      compareReports(escapeNative, escapeNode, app, 'init escape');
      assert.equal(escapeNative.report.code, 'ELECTRON_MBT_PATH_ESCAPE');
    } finally { fs.rmSync(outside, { recursive: true, force: true }); }

    const missingNative = runNative(['inspect', path.join(app.native, 'does-not-exist')], app.native);
    const missingNode = runNode(['inspect', path.join(app.node, 'does-not-exist')], app.node);
    assert.equal(missingNative.result.status, missingNode.result.status);
    assert.equal(missingNative.report.code, missingNode.report.code);
  } finally { cleanup(app); }
});

test('native dev --no-launch matches the reference doctor report', () => {
  const app = pair();
  try {
    const native = runNative(['dev', '--no-launch', '--api', 'adapted-preload.json', app.native], app.native,
      { EMOON_HOST: hostBinary });
    const node = runNode(['dev', '--no-launch', '--api', 'adapted-preload.json', '--runtime', nativeCli(), app.node], app.node);
    compareReports(native, node, app, 'dev no-launch');
    assert.equal(native.result.status, 0, native.stderr);
    assert.equal(native.report.command, 'doctor');
    assert.equal(native.report.status, 'ready');
    assert.equal(native.report.profile, 'electron-nodeless-adapted-v1');
    assert.equal(native.report.compatible, false);
    assert.deepEqual(tree(path.join(app.native, '.emoon/app')), tree(path.join(app.node, '.emoon/app')));
  } finally { cleanup(app); }
});

test('native dev runs the adapted window without a compatibility claim', {
  skip: process.platform !== 'linux' || !fs.existsSync(hostBinary) || !process.env.DISPLAY,
}, () => {
  const app = temporaryApp();
  try {
    const native = runNative(['dev', '--api', 'adapted-preload.json', app], app,
      { EMOON_HOST: hostBinary, ELECTRON_MBT_TEST_MODE: '1' });
    assert.equal(native.result.status, 0, `${native.stdout}\n${native.stderr}`);
    assert.equal(native.report.status, 'PASS');
    assert.equal(native.report.pageTitle, 'migrate-fixture-ready');
    assert.equal(native.report.adapted && native.report.adapted.requests, 1);
    assert.equal(native.report.compatible, false);
  } finally { fs.rmSync(app, { recursive: true, force: true }); }
});
