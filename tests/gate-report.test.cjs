'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildMarkdown } = require('../scripts/gate-report.cjs');

test('gate report stays NOT_READY and preserves open gates', () => {
  const markdown = buildMarkdown();
  assert.match(markdown, /Status: \*\*NOT_READY\*\*/);
  assert.match(markdown, /G2/);
  assert.match(markdown, /NOT_RUN/);
  assert.match(markdown, /no-verified-claims/);
  assert.match(markdown, /preview-signing/);
  assert.match(markdown, /compatible:false/);
  assert.doesNotMatch(markdown, /Status: \*\*READY\*\*/);
});
