'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const script = path.join(root, 'scripts/capture-preload-api.cjs');
const fixture = path.join(root, 'fixtures/preload-capture/preload.js');

test('preload capture records calls, topics and explicit operation overrides', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'emoon-preload-capture-'));
  const output = path.join(directory, 'api.json');
  try {
    const result = spawnSync(process.execPath, [
      script, fixture, '--name', 'demo', '--out', output,
      '--operation', 'stream=emoon:read-file',
    ], { cwd: root, encoding: 'utf8', timeout: 30000 });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const summary = JSON.parse(result.stdout.trim());
    assert.equal(summary.ok, true);
    assert.equal(summary.name, 'demo');
    assert.equal(summary.calls, 4);
    assert.equal(summary.topics, 1);
    assert.equal(summary.unsupported, 1);
    const manifest = JSON.parse(fs.readFileSync(output, 'utf8'));
    assert.equal(manifest.schema, 3);
    assert.equal(manifest.name, 'demo');
    assert.deepEqual(manifest.topics, [{ topic: 'demo:event', method: 'onEvent' }]);
    const byName = Object.fromEntries(manifest.calls.map(call => [call.name, call]));
    assert.deepEqual(byName.getValue, { name: 'getValue', operation: 'demo:get', args: 'none' });
    assert.deepEqual(byName.setValue, { name: 'setValue', operation: 'demo:set', args: 'json-list', arity: 1 });
    assert.deepEqual(byName.ping, { name: 'ping', operation: 'demo:ping', args: 'none' });
    assert.deepEqual(byName.stream, { name: 'stream', operation: 'emoon:read-file', args: 'json-list', arity: 1 });
    assert.deepEqual(manifest.unsupported.map(item => item.name), ['localOnly']);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
