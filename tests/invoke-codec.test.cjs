'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { encodeInvoke, decodeInvoke, cloneInvoke } = require('../bridges/node/invoke-codec.cjs');

for (const [label, value] of [
  ['top-level undefined', undefined],
  ['null', null],
  ['booleans', [true, false]],
  ['finite numbers', [1, -42.5, 0, 1e100]],
  ['Unicode and lone surrogate strings', ['あいう', '\ud800', '🌙']],
  ['undefined inside dense arrays and plain records', [undefined, null, { present: undefined, nested: [undefined, 7] }]],
  ['lookalike tags', { '0': 'value', t: 0, value: { '1': 2 } }],
  ['null-prototype input record', Object.assign(Object.create(null), { present: undefined })],
  ['prototype-named keys', Object.fromEntries([['__proto__', undefined], ['constructor', null], ['toString', 3]])],
]) {
  test(`invoke codec round-trips ${label}`, () => {
    const raw = encodeInvoke(value);
    assert.deepStrictEqual(decodeInvoke(raw), cloneInvoke(value));
    const restored = cloneInvoke(value);
    if (label === 'null-prototype input record') assert.deepStrictEqual(restored, { present: undefined });
    else assert.deepStrictEqual(restored, value);
    if (label === 'prototype-named keys') {
      assert.equal(Object.getPrototypeOf(restored), Object.prototype);
      assert.equal(Object.hasOwn(restored, '__proto__'), true);
    }
  });
}

test('invoke codec never invokes getters or toJSON on application inputs', () => {
  let reads = 0;
  const object = { get x() { reads++; return 42; }, toJSON() { reads++; return 'poison'; } };
  assert.throws(() => cloneInvoke(object), { code: 'ELECTRON_MBT_UNSUPPORTED_VALUE' });
  assert.equal(reads, 0);
  const array = [1];
  Object.defineProperty(array, '0', { get() { reads++; return 42; }, enumerable: true });
  assert.throws(() => cloneInvoke(array), { code: 'ELECTRON_MBT_UNSUPPORTED_VALUE' });
  assert.equal(reads, 0);
});

test('invoke codec rejects proxies, cycles, repeated identity and unsupported objects', () => {
  const self = {}; self.self = self;
  const shared = {}; const repeated = [shared, shared];
  for (const value of [self, repeated, new Proxy({}, {}), new Date(), new Map(), new Set(), new Uint8Array(), () => {}, Symbol('x'), 2n, NaN, Infinity, -0]) {
    assert.throws(() => encodeInvoke(value), { code: 'ELECTRON_MBT_UNSUPPORTED_VALUE' });
  }
});

test('invoke codec rejects sparse arrays, extra array keys and nonenumerable data', () => {
  const sparse = [, 2];
  const extra = [1]; extra.other = 2;
  const hidden = {}; Object.defineProperty(hidden, 'x', { value: 1 });
  for (const value of [sparse, extra, hidden]) {
    assert.throws(() => encodeInvoke(value), { code: 'ELECTRON_MBT_UNSUPPORTED_VALUE' });
  }
});

test('invoke codec bounds recursion and final UTF-8 wire size', () => {
  let nested = 1;
  for (let i = 0; i < 66; i++) nested = [nested];
  assert.throws(() => encodeInvoke(nested), { code: 'ELECTRON_MBT_LIMIT' });
  assert.throws(() => cloneInvoke('x'.repeat(1048576)), { code: 'ELECTRON_MBT_LIMIT' });
  assert.throws(() => decodeInvoke(' '.repeat(1048577)), { code: 'ELECTRON_MBT_LIMIT' });
});

for (const raw of [
  'not JSON', '[]', '{}', '[0,2]', '[1]', '[2]', '[3]', '[4,2]', '[1,{}]',
  '[1,1e999]', '[2,[null]]', '[2,[[1,2],[0,1]]]', '[3,[["x",[0]],["x",[1,1]]]]',
  '[3,[["x"]]]', '[3,[[1,[0]]]]', '[3,[{"x":[0]}]]',
]) {
  test(`malformed invoke envelope is rejected: ${raw.slice(0,25)}`, () => {
    assert.throws(() => decodeInvoke(raw), { code: 'ELECTRON_MBT_INVALID_PAYLOAD' });
  });
}

test('decoder bounds recursively encoded object depth', () => {
  let raw = '[1,1]';
  for (let i = 0; i < 66; i++) raw = `[2,[${raw}]]`;
  assert.throws(() => decodeInvoke(raw), { code: 'ELECTRON_MBT_LIMIT' });
});


test('internal wire serialization does not consult inherited toJSON hooks', () => {
  const old = Object.getOwnPropertyDescriptor(Array.prototype, 'toJSON');
  let calls = 0;
  Object.defineProperty(Array.prototype, 'toJSON', {
    configurable: true, value() { calls++; throw new Error('prototype hook invoked'); },
  });
  try {
    assert.deepStrictEqual(cloneInvoke([undefined, { nested: [null, undefined] }]),
      [undefined, { nested: [null, undefined] }]);
    assert.equal(calls, 0);
  } finally {
    if (old) Object.defineProperty(Array.prototype, 'toJSON', old);
    else delete Array.prototype.toJSON;
  }
});
