'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { check } = require('../scripts/moji-adapted-check.cjs');
const { run } = require('../scripts/moji-adapted-api-check.cjs');

test('the Moji adapted API record matches the pinned preload and generated adapter', () => {
  const result = check();
  assert.equal(result.status, 'PASS');
  assert.equal(result.appId, 'moji-v1.0.5');
  assert.match(result.adapterSHA256, /^[a-f0-9]{64}$/);
  assert.match(result.preloadSHA256, /^[a-f0-9]{64}$/);
  assert.equal(result.calls, 14);
  assert.equal(result.topics, 3);
  assert.deepEqual(result.unsupported, ['getDroppedPath']);
  assert.equal(result.runtime, 'NOT_IMPLEMENTED');
  assert.deepEqual(result.errors, []);
});

test('the Moji adapted API shape, disposers and queue contract pass', async () => {
  const result = await run();
  const failed = result.cases.filter(item => item.status !== 'PASS');
  assert.deepEqual(failed, []);
  assert.equal(result.status, 'PASS');
  assert.equal(result.compatible, false);
});
