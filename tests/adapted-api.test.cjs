'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { run } = require('../scripts/adapted-api-check.cjs');

test('the adapted page-local listener and queue contract passes', async () => {
  const result = await run();
  const failed = result.cases.filter(item => item.status !== 'PASS');
  assert.deepEqual(failed, []);
  assert.equal(result.status, 'PASS');
  assert.equal(result.compatible, false);
});
