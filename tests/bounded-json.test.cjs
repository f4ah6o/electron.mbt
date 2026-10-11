'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { encodeData } = require('../bridges/node/bounded-json.cjs');
// Leaf tests supply deliberately small budgets, not a substitute runtime core.
const limits = Object.freeze({ bytes: 1024, wireNodes: 100, wireDepth: 8 });
const error = { code: 'ELECTRON_MBT_PROTOCOL' };

test('What: reflective encoding preserves supported data and ignores inherited toJSON', () => {
  let calls = 0;
  Object.defineProperty(Object.prototype, 'toJSON', { configurable: true, get() { calls++; throw Error('must not execute'); } });
  try {
    const value = { text: '日本語😀\n\u0000', nested: [null, true, 1.5] };
    assert.deepEqual(JSON.parse(encodeData(value, limits)), value);
    assert.equal(calls, 0);
  } finally { delete Object.prototype.toJSON; }
});
test('What: lossy JavaScript values and object shapes are rejected before serialization', () => {
  const hidden = {}; Object.defineProperty(hidden, 'value', { value: 1 });
  const extended = [1]; extended.extra = 2;
  const symbolic = { [Symbol('key')]: 1 };
  const shared = {};
  const cycle = {}; cycle.self = cycle;
  for (const value of [undefined, NaN, Infinity, -Infinity, -0, 1n, Symbol('value'), () => 1, new Date(), new Map(), new Uint8Array(1), [,], extended, hidden, symbolic, [shared, shared], cycle, '\ud800']) {
    assert.throws(() => encodeData({ value }, limits), error);
  }
});
test('What: getters, own toJSON and proxy traps are never invoked', () => {
  let calls = 0;
  const getter = Object.defineProperty({}, 'value', { enumerable: true, get() { calls++; return 1; } });
  const custom = { toJSON() { calls++; return {}; } };
  const proxy = new Proxy({}, { ownKeys() { calls++; return []; }, getPrototypeOf() { calls++; return null; } });
  for (const value of [getter, custom, proxy]) assert.throws(() => encodeData(value, limits), error);
  assert.equal(calls, 0);
});
test('What: exact encoded byte budgets include multibyte characters and escaping', () => {
  for (const value of [{ text: '日本語😀\u0000\n\\"' }, [], [1, 2], { a: true, b: false }]) {
    const size = Buffer.byteLength(JSON.stringify(value));
    assert.equal(Buffer.byteLength(encodeData(value, { ...limits, bytes: size })), size);
    assert.throws(() => encodeData(value, { ...limits, bytes: size - 1 }), error);
  }
});
test('What: structural budgets stop deep and wide reflection', () => {
  assert.throws(() => encodeData(Array(101).fill(0), limits), error);
  let deep = {}; for (let i = 0; i < 9; i++) deep = { child: deep };
  assert.throws(() => encodeData(deep, limits), error);
  assert.throws(() => encodeData({ a: Array(60).fill(0), b: Array(60).fill(0) }, limits), error);
});
test('What: a 64 MB process rejects huge outbound values without materializing the encoding', () => {
  const modulePath = require.resolve('../bridges/node/bounded-json.cjs');
  const script = `
    const { encodeData } = require(${JSON.stringify(modulePath)});
    const limits = { bytes: 1048576, wireNodes: 100008, wireDepth: 65 };
    for (const value of ['x'.repeat(96 * 1024 * 1024), '\\u0000'.repeat(1048576), Object.fromEntries(Array.from({length: 100001}, (_, i) => ['k' + i, 0]))]) {
      try { encodeData({ value }, limits); process.exit(2); }
      catch (error) { if (error.code !== 'ELECTRON_MBT_PROTOCOL') throw error; }
    }
  `;
  const result = spawnSync(process.execPath, ['--max-old-space-size=64', '-e', script], { encoding: 'utf8', timeout: 15000 });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.signal, null);
});
