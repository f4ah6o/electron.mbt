'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { collectApp, validateAppRecord, writeAppRecord, RECORD_FILES } = require('../../scripts/app-inventory.cjs');
const root = path.resolve(__dirname, '../..');

function temp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'electron-mbt-app-inventory-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function fixture(t) {
  const dir = temp(t);
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'inventory-fixture', version: '0.0.0', main: 'main.cjs' }));
  fs.writeFileSync(path.join(dir, 'main.cjs'), [
    "const fs = require('node:fs');",
    "const path = require('path');",
    "const dep = require('./dependency/index.cjs');",
    "const pkg = require('fixture-pkg');",
    "process.stdout.write(JSON.stringify({ fs: !!fs, path: path.sep, dep: !!dep, pkg: !!pkg }));",
  ].join('\n'));
  fs.mkdirSync(path.join(dir, 'dependency'));
  fs.writeFileSync(path.join(dir, 'dependency/index.cjs'), "module.exports = { value: 1 };\n");
  fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><title>fixture</title>');
  return dir;
}

function args(app, out, revision = 'a'.repeat(40)) {
  return [
    '--app', app, '--out', out, '--id', 'inventory-fixture', '--revision', revision,
    '--source-url', 'https://example.invalid/fixture', '--license', 'MIT',
    '--input-mode', 'original-cjs', '--preload-mode', 'original',
  ];
}

test('the collector writes all seven records and leaves app sources unchanged', (t) => {
  const app = fixture(t);
  const out = temp(t);
  const before = JSON.stringify(fs.readdirSync(app).sort());
  const record = collectApp({
    appDir: app, appId: 'inventory-fixture', revision: 'a'.repeat(40),
    sourceUrl: 'https://example.invalid/fixture', license: 'MIT',
    inputMode: 'original-cjs', preloadMode: 'original', collectedAt: '2026-10-17T00:00:00Z',
  });
  assert.deepEqual(Object.keys(record), RECORD_FILES);
  assert.deepEqual(validateAppRecord(record), { ok: true, problems: [] });
  assert.match(record['inventory.json'].sourceHash, /^[a-f0-9]{64}$/);
  assert.equal(record['target.json'].revision, 'a'.repeat(40));
  assert.ok(record['symbols.json'].builtins.includes('node:fs'));
  assert.ok(record['symbols.json'].builtins.includes('path'));
  assert.ok(record['symbols.json'].packages.includes('fixture-pkg'));
  assert.ok(record['symbols.json'].localImports.includes('./dependency/index.cjs'));
  assert.equal(record['symbols.json'].completeness, 'static-source-only');
  assert.equal(record['build-provenance.json'].status, 'NOT_RUN');
  writeAppRecord(out, record);
  assert.deepEqual([...fs.readdirSync(out)].sort(), [...RECORD_FILES].sort());
  assert.equal(JSON.stringify(fs.readdirSync(app).sort()), before);
});

test('the CLI rejects an output directory that overlaps the app source', (t) => {
  const app = fixture(t);
  const result = spawnSync(process.execPath, [path.join(root, 'scripts/app-inventory.cjs'), ...args(app, path.join(app, 'inventory-out'))], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /output directory must not overlap/);
  assert.equal(fs.existsSync(path.join(app, 'inventory-out')), false);
});

test('the CLI rejects invalid revisions and writes no record', (t) => {
  const app = fixture(t);
  const out = temp(t);
  const result = spawnSync(process.execPath, [path.join(root, 'scripts/app-inventory.cjs'), ...args(app, out, 'not-a-sha')], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /40-character commit SHA/);
  assert.equal(fs.existsSync(path.join(out, 'target.json')), false);
});

test('a collected record without a valid source hash is invalid', (t) => {
  const app = fixture(t);
  const record = collectApp({
    appDir: app, appId: 'inventory-fixture', revision: 'a'.repeat(40),
    sourceUrl: 'https://example.invalid/fixture', license: 'MIT',
    inputMode: 'original-cjs', preloadMode: 'original',
  });
  record['inventory.json'].sourceHash = 'short';
  assert.ok(validateAppRecord(record).problems.some((problem) => problem.includes('sourceHash')));
});

test('the pinned Moji and jmd records validate without claiming collected builds', () => {
  for (const appId of ['moji-v1.0.5', 'jmd-v0.2.3']) {
    const dir = path.join(root, 'compatibility/apps', appId);
    const record = {};
    for (const file of RECORD_FILES) record[file] = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
    assert.deepEqual(validateAppRecord(record), { ok: true, problems: [] }, appId);
    assert.equal(record['build-provenance.json'].status, 'NOT_RUN', appId);
    assert.equal(record['inventory.json'].status, 'not-collected', appId);
  }
});
