'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { buildAdapter } = require('../scripts/adapted-adapter.cjs');
const { check } = require('../scripts/adapted-preload-check.cjs');

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
  assert.deepEqual(admitted.errors, []);
});

test('the adapter generator rejects malformed API manifests', () => {
  assert.throws(() => buildAdapter({}), /schema 1/);
  assert.throws(() => buildAdapter({ schema: 1, name: 'api', methods: [{ name: 'bad-name', returns: 'x' }] }), /invalid method/);
  assert.throws(() => buildAdapter({ schema: 1, name: 'api', methods: [{ name: 'x', returns: 1 }] }), /invalid method/);
});
