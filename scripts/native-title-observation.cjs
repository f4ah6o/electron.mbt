'use strict';
const assert = require('node:assert/strict');
const { performance } = require('node:perf_hooks');

// WKWebView's observable title may update after its navigation completion.
// Do not fabricate or cache a value to make a timing-sensitive test pass.
async function expectNativeTitle(readTitle, expected, timeoutMs = 3000) {
  assert.equal(typeof readTitle, 'function');
  const deadline = performance.now() + timeoutMs;
  let observed;
  do {
    observed = readTitle();
    if (observed === expected) return observed;
    if (performance.now() >= deadline) break;
    await new Promise(resolve => setTimeout(resolve, 30));
  } while (true);
  assert.equal(observed, expected, 'Actual WKWebView title did not become observable before the deadline');
}

module.exports = { expectNativeTitle };
