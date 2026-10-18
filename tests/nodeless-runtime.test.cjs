'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { buildSourceManifest, writeSourceManifest } = require('../scripts/source-manifest.cjs');

const root = path.resolve(__dirname, '..');
const fixture = path.join(root, 'fixtures/nodeless-app');
const binaryCandidates = [
  path.join(root, '_build/native/debug/build/native/nodeless/nodeless.exe'),
  path.join(root, '_build/native/debug/build/native/nodeless/nodeless'),
];

function buildBinary() {
  const build = spawnSync('moon', ['build', '--target', 'native', 'native/nodeless'], {
    cwd: root, encoding: 'utf8', timeout: 180000,
  });
  assert.equal(build.status, 0, `moon build failed\n${build.stdout}\n${build.stderr}`);
  const binary = binaryCandidates.find(candidate => fs.existsSync(candidate));
  assert.ok(binary, 'nodeless binary was not produced');
  return binary;
}

function run(binary, appDir, extraEnv = {}) {
  const fakeBin = fs.mkdtempSync(path.join(os.tmpdir(), 'electron-mbt-nodeless-path-'));
  const fakeNode = path.join(fakeBin, 'node');
  fs.writeFileSync(fakeNode, '#!/bin/sh\nexit 99\n');
  fs.chmodSync(fakeNode, 0o700);
  const result = spawnSync(binary, ['run', appDir], {
    cwd: root,
    encoding: 'utf8',
    timeout: 30000,
    env: {
      ...process.env,
      PATH: `${fakeBin}${path.delimiter}${process.env.PATH || ''}`,
      NODELESS_FIXTURE_ENV: 'fixture-value',
      SECRET_TOKEN: 'must-not-leak',
      ...extraEnv,
    },
  });
  fs.rmSync(fakeBin, { recursive: true, force: true });
  const lines = `${result.stdout || ''}\n${result.stderr || ''}`.split('\n')
    .map(line => line.trim()).filter(line => line.startsWith('{') && line.endsWith('}'));
  let report = null;
  if (lines.length > 0) {
    try { report = JSON.parse(lines.at(-1)); } catch { report = null; }
  }
  return { result, report };
}

function manifestFor(appDir, entry, files) {
  const manifest = buildSourceManifest(appDir, entry, 'nodeless-test', files);
  writeSourceManifest(path.join(appDir, 'source-manifest.json'), manifest);
}

function temporaryApp(mainSource, files = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'electron-mbt-nodeless-app-'));
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src/main.js'), mainSource);
  fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"nodeless-test","version":"1.0.0","main":"src/main.js"}\n');
  for (const [file, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.writeFileSync(path.join(dir, file), content);
  }
  manifestFor(dir, 'src/main.js', ['package.json', 'src/main.js', ...Object.keys(files)]);
  return dir;
}

test('Node-less runtime executes the fixture without Node and fails closed', () => {
  const binary = buildBinary();
  const { result, report } = run(binary, fixture);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.ok(report, 'missing JSON report');
  assert.equal(report.schema, 1);
  assert.equal(report.probe, 'nodeless-main-runtime');
  assert.equal(report.status, 'PASS');
  assert.equal(report.engine, 'quickjs-2026-06-04');
  assert.equal(report.profile, 'electron-nodeless-adapted-v1');
  assert.equal(report.strict, 'blocked');
  assert.equal(report.compatible, false);
  assert.equal(report.app.entry, 'src/main.js');
  assert.equal(report.app.modules, 6);
  assert.equal(report.liveLeases, 0);
  assert.equal(report.nodeProcesses, 0);

  const manifestBytes = fs.readFileSync(path.join(fixture, 'source-manifest.json'));
  const manifestHash = crypto.createHash('sha256').update(manifestBytes).digest('hex');
  assert.equal(report.app.manifestSha256, manifestHash);

  const resultOf = name => report.results[name].result;
  const main = resultOf('selftest:report');
  assert.equal(main.app, 'nodeless-fixture');
  assert.equal(main.version, '1.0.0');
  assert.equal(main.a, 'a');
  assert.equal(main.b, 'b');
  assert.equal(main.cycleA, 'b');
  assert.equal(main.cycleB, 'a');
  assert.equal(main.pkg, 'package');
  assert.equal(main.data, 'fixture');
  assert.equal(main.joined, 'src/lib/a.js');
  assert.equal(main.b64, 'aGk=');
  assert.equal(main.event, 1);
  assert.equal(main.nextTick, true);
  assert.equal(main.fixtureEnv, 'fixture-value');
  assert.equal(main.secretEnv, null);
  assert.equal(resultOf('selftest:async').value, 9);
  assert.deepEqual(resultOf('selftest:order').order, ['tick', 'promise', 'timer']);
  assert.equal(resultOf('selftest:unsupported').code, 'ELECTRON_MBT_UNSUPPORTED_BUILTIN');
});

test('the nodeless binary does not link or import Node/Node-API', () => {
  const binary = buildBinary();
  const isMac = process.platform === 'darwin';
  const linked = spawnSync(isMac ? 'otool' : 'ldd', isMac ? ['-L', binary] : [binary], {
    encoding: 'utf8',
  });
  if (linked.status === 0) {
    const text = `${linked.stdout}\n${linked.stderr}`.toLowerCase();
    assert.equal(text.includes('libnode'), false);
    assert.equal(text.includes('electron framework'), false);
  }
  const symbols = spawnSync(isMac ? 'nm' : 'nm', isMac ? ['-u', binary] : ['-D', '--undefined-only', binary], {
    encoding: 'utf8',
  });
  if (symbols.status === 0) {
    const text = `${symbols.stdout}\n${symbols.stderr}`.toLowerCase();
    assert.equal(text.includes('napi_'), false);
    assert.equal(text.includes('node::'), false);
  }
});

test('a source hash mismatch fails closed', () => {
  const binary = buildBinary();
  const dir = temporaryApp('module.exports = 1;\n');
  try {
    const manifestPath = path.join(dir, 'source-manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    manifest.files[0].sha256 = '0'.repeat(64);
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    const { result, report } = run(binary, dir);
    assert.notEqual(result.status, 0);
    assert.ok(report);
    assert.equal(report.status, 'FAIL');
    assert.equal(report.code, 'ELECTRON_MBT_NODELESS_SOURCE_HASH');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a computed require is rejected before evaluation', () => {
  const binary = buildBinary();
  const dir = temporaryApp('const name = "./x"; require(name);\n');
  try {
    const { result, report } = run(binary, dir);
    assert.notEqual(result.status, 0);
    assert.ok(report);
    assert.equal(report.status, 'FAIL');
    assert.equal(report.code, 'ELECTRON_MBT_DYNAMIC_REQUIRE');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
