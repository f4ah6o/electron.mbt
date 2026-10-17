'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildReport } = require('../scripts/preview-readiness.cjs');

test('preview readiness stays NOT_READY and never promotes unverified work', () => {
  const report = buildReport();
  assert.equal(report.status, 'NOT_READY');
  assert.equal(report.compatible, false);
  assert.equal(report.gates.G2, 'NOT_RUN');
  const checks = new Map(report.checks.map(item => [item.id, item]));
  assert.equal(checks.get('no-verified-claims').status, 'PASS');
  assert.equal(checks.get('compatible-false').status, 'PASS');
  assert.equal(checks.get('production-closure:moji-v1.0.5').status, 'PASS');
  assert.equal(checks.get('sbom:moji-v1.0.5').status, 'PASS');
  assert.equal(checks.get('moji-preload-runtime').status, 'FAIL');
  assert.equal(checks.get('node-less-moji-app-main').status, 'NOT_RUN');
  assert.equal(checks.get('preview-signing').status, 'NOT_RUN');
  assert.ok(report.counts.fail > 0);
});
