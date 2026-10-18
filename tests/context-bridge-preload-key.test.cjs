'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { discoverPreloadApiKey } = require('../bridges/node/preload-key.cjs');

function preload(expose) {
  return `'use strict';\nconst { contextBridge } = require('electron');\n${expose}\n`;
}

test('What: the preload key preview discovers deterministic contextBridge keys', () => {
  const oracle = fs.readFileSync(path.resolve(__dirname, '../fixtures/oracle/preload.cjs'), 'utf8');
  const edge = fs.readFileSync(path.resolve(__dirname, '../fixtures/b6-preload-app/edge-preload.cjs'), 'utf8');
  const oraclePreview = discoverPreloadApiKey(oracle);
  const edgePreview = discoverPreloadApiKey(edge);
  assert.equal(oraclePreview.apiKey, 'fixture');
  assert.equal(oraclePreview.functionCount, 10);
  assert.match(oraclePreview.descriptorSha256, /^[0-9a-f]{64}$/);
  assert.equal(edgePreview.apiKey, 'edge');
  assert.equal(edgePreview.functionCount, 31);
  assert.match(edgePreview.descriptorSha256, /^[0-9a-f]{64}$/);
  assert.equal(discoverPreloadApiKey(preload('contextBridge.exposeInMainWorld("custom-key", { value: 1 });')).apiKey,
    'custom-key');
  assert.equal(discoverPreloadApiKey(preload('const key = "computed"; contextBridge.exposeInMainWorld(key, {});')).apiKey,
    'computed');
});

test('What: the key preview fails closed for reserved, missing, multiple, unsupported or failing preloads', () => {
  for (const key of ['window', 'document', 'globalThis', 'process', 'require', 'module',
    'exports', 'electron', '__proto__', 'prototype', 'constructor', '', 'x'.repeat(65)]) {
    assert.throws(() => discoverPreloadApiKey(preload(
      `contextBridge.exposeInMainWorld(${JSON.stringify(key)}, {});`)),
    /Invalid exposed API key/);
  }
  assert.throws(() => discoverPreloadApiKey(preload('contextBridge.exposeInMainWorld("a", {}); contextBridge.exposeInMainWorld("b", {});')),
    /one exposed API key/);
  assert.throws(() => discoverPreloadApiKey(preload('const x = 1;')), /exactly one API key/);
  assert.throws(() => discoverPreloadApiKey(preload('require("node:fs");')),
    /Preload key preview failed/);
  assert.throws(() => discoverPreloadApiKey(preload('throw new Error("boom");')),
    /Preload key preview failed/);
  assert.throws(() => discoverPreloadApiKey('not valid JavaScript {' ),
    /Preload key preview failed/);
});
