'use strict';
// J1: the pinned jmd main requests a privileged custom scheme. The adapted
// runtime must stop it explicitly at main evaluation, with no window, no
// registered scheme and no file read. This synthetic fixture pins the exact
// declaration shape; scripts/jmd-j1.cjs runs the real pinned source.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { buildSourceManifest, writeSourceManifest } = require('../../scripts/source-manifest.cjs');

const root = path.resolve(__dirname, '../..');

function buildBinary() {
  const build = spawnSync('moon', ['build', '--target', 'native', 'cmd/emoon'], {
    cwd: root, encoding: 'utf8', timeout: 180000,
  });
  assert.equal(build.status, 0, `moon build failed\n${build.stdout}\n${build.stderr}`);
  const candidates = [
    path.join(root, '_build/native/debug/build/cmd/emoon/emoon.exe'),
    path.join(root, '_build/native/debug/build/cmd/emoon/emoon'),
  ];
  const binary = candidates.find(candidate => fs.existsSync(candidate));
  assert.ok(binary, 'emoon binary was not produced');
  return binary;
}

function appWithMain(source) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'electron-mbt-j1-'));
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src/main.js'), source);
  fs.writeFileSync(path.join(dir, 'package.json'),
    '{"name":"jmd-j1","version":"0.2.3","main":"src/main.js"}\n');
  const manifest = buildSourceManifest(dir, 'src/main.js', 'jmd-j1', [
    'package.json', 'src/main.js',
  ]);
  writeSourceManifest(path.join(dir, 'source-manifest.json'), manifest);
  return dir;
}

function run(binary, app) {
  const result = spawnSync(binary, ['run', app], {
    cwd: root, encoding: 'utf8', timeout: 30000,
  });
  const lines = `${result.stdout || ''}\n${result.stderr || ''}`.split('\n')
    .map(line => line.trim()).filter(line => line.startsWith('{') && line.endsWith('}'));
  let report = null;
  if (lines.length > 0) {
    try { report = JSON.parse(lines.at(-1)); } catch { report = null; }
  }
  return { result, report, output: `${result.stdout || ''}\n${result.stderr || ''}` };
}

test('jmd J1: bypassCSP is rejected at main evaluation with a typed error', () => {
  const binary = buildBinary();
  const app = appWithMain([
    "'use strict';",
    "const { protocol } = require('electron');",
    "protocol.registerSchemesAsPrivileged([{",
    "  scheme: 'jmd-file',",
    "  privileges: { standard: true, secure: true, supportFetchAPI: true, bypassCSP: true },",
    "}]);",
    "throw new Error('unreachable');",
    '',
  ].join('\n'));
  try {
    const { result, report, output } = run(binary, app);
    assert.notEqual(result.status, 0, output);
    assert.ok(report, output);
    assert.equal(report.status, 'FAIL');
    assert.equal(report.code, 'ELECTRON_MBT_MAIN_EVAL');
    assert.ok(output.includes('ELECTRON_MBT_UNSUPPORTED_PROTOCOL_PRIVILEGE'), output);
    assert.ok(!output.includes('unreachable'),
      'main evaluation must stop at the protocol declaration, not reach later code');
    assert.equal(report.compatible, false);
  } finally {
    fs.rmSync(app, { recursive: true, force: true });
  }
});

test('a safe custom scheme is still rejected when the stage does not admit it', () => {
  const binary = buildBinary();
  const app = appWithMain([
    "'use strict';",
    "const { protocol } = require('electron');",
    "protocol.registerSchemesAsPrivileged([{ scheme: 'jmd-file', privileges: { standard: true, secure: true } }]);",
    "throw new Error('unreachable');",
    '',
  ].join('\n'));
  try {
    const { result, report, output } = run(binary, app);
    assert.notEqual(result.status, 0, output);
    assert.ok(report, output);
    assert.equal(report.code, 'ELECTRON_MBT_MAIN_EVAL');
    assert.ok(output.includes('ELECTRON_MBT_PROTOCOL_SCHEME_NOT_ADMITTED'), output);
    assert.ok(!output.includes('unreachable'), output);
  } finally {
    fs.rmSync(app, { recursive: true, force: true });
  }
});
