'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { buildAdapter } = require('../scripts/adapted-adapter.cjs');
const { check } = require('../scripts/adapted-preload-check.cjs');

const queue = { maxCalls: 4, maxBytes: 16384, readyTimeoutMs: 300 };
const topics = [{ topic: 'doc:open', method: 'onOpenDocument' }];
const calls = [{ name: 'getSettings', operation: 'app:get-settings', args: 'none' }];

test('the generated adapted page adapter is deterministic and admitted', () => {
  const manifest = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../fixtures/native-app/adapted/api.json'), 'utf8'));
  const generated = buildAdapter(manifest);
  const committed = fs.readFileSync(path.resolve(__dirname, '../fixtures/native-app/adapted/page-api.js'), 'utf8');
  assert.equal(generated.source, committed);
  assert.match(generated.sha256, /^[a-f0-9]{64}$/);
  const admitted = check();
  assert.equal(admitted.status, 'PASS');
  assert.equal(admitted.originalPreload, 'NOT_EXECUTED');
  assert.equal(admitted.adapterSHA256, generated.sha256);
  assert.equal(admitted.topics, manifest.topics.length);
  assert.equal(admitted.calls, manifest.calls.length);
  assert.equal(admitted.ingress, 'ABSENT');
  assert.deepEqual(admitted.errors, []);
});

test('the adapter generator rejects malformed API manifests', () => {
  assert.throws(() => buildAdapter({}), /schema 2/);
  const base = { schema: 2, name: 'api', version: 'fixture', topics, calls, queue };
  assert.throws(() => buildAdapter({ ...base, name: 'bad-name' }), /invalid API name/);
  assert.throws(() => buildAdapter({ ...base, version: '' }), /invalid API version/);
  assert.throws(() => buildAdapter({ ...base, topics: [] }), /topics/);
  assert.throws(() => buildAdapter({ ...base, topics: [{ topic: 'doc:open', method: 'bad-name' }] }), /invalid topic/);
  assert.throws(() => buildAdapter({ ...base, calls: [{ name: 'getSettings', operation: 'op', args: 'raw' }] }), /invalid call args/);
  assert.throws(() => buildAdapter({ ...base, queue: { maxCalls: 0, maxBytes: 1, readyTimeoutMs: 1 } }), /queue limits/);
  assert.throws(() => buildAdapter({ ...base, calls: [{ name: 'version', operation: 'op', args: 'none' }] }), /reserved API name/);
});
