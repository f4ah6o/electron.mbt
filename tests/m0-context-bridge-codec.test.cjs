'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { createCodec, makeArray, arrayPush } = require('../fixtures/worlds/m0-cb-codec.js');

const secret = '0123456789abcdef'.repeat(4);

function codec(overrides) {
  return createCodec(Object.assign({ secret }, overrides || {}));
}

test('What: the test-only SHA-256 and HMAC match Node crypto', () => {
  const c = codec();
  assert.equal(c.sha256Hex(''),
    'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  assert.equal(c.sha256Hex('abc'),
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  const long = 'x'.repeat(1000);
  assert.equal(c.sha256Hex(long), crypto.createHash('sha256').update(long).digest('hex'));

  const direction = 'i2p';
  const session = 'session-1';
  const messageId = 'call-7';
  const payload = JSON.stringify({ value: 42, text: 'hello' });
  const expected = crypto.createHmac('sha256', secret)
    .update(c.contextString(direction, session, messageId, payload), 'utf8')
    .digest('hex');
  assert.equal(c.hmac(direction, session, messageId, payload), expected);
  assert.equal(c.verify(direction, session, messageId, payload, expected), true);
  assert.equal(c.verify('p2i', session, messageId, payload, expected), false);
  assert.equal(c.verify(direction, 'other', messageId, payload, expected), false);
  assert.equal(c.verify(direction, session, 'call-8', payload, expected), false);
  assert.equal(c.verify(direction, session, messageId, payload + 'x', expected), false);
});

test('What: plain values round trip and are not polluted by page toJSON', () => {
  const c = codec();
  const value = {
    nullValue: null,
    boolean: true,
    integer: 42,
    fraction: -1.5,
    text: 'hello',
    nested: { value: 7 },
    list: [1, 'two', false, null, { deep: 'yes' }],
  };
  const json = c.encodeData(value);
  assert.deepEqual(c.decodeData(json), value);

  const originalObjectToJSON = Object.prototype.toJSON;
  const originalArrayToJSON = Array.prototype.toJSON;
  Object.prototype.toJSON = function poisonedObjectToJSON() { return 'polluted'; };
  Array.prototype.toJSON = function poisonedArrayToJSON() { return 'polluted'; };
  try {
    const again = c.encodeData(value);
    assert.deepEqual(c.decodeData(again), value);
    assert.equal(c.encodeData([1, 2, 3]), c.encodeData([1, 2, 3]));
  } finally {
    if (originalObjectToJSON === undefined) delete Object.prototype.toJSON;
    else Object.prototype.toJSON = originalObjectToJSON;
    if (originalArrayToJSON === undefined) delete Array.prototype.toJSON;
    else Array.prototype.toJSON = originalArrayToJSON;
  }
});

test('What: functions, Promises and Errors use explicit handles only when allowed', () => {
  const c = codec();
  const original = () => 7;
  const json = c.encode({ fn: original }, {
    allowFunctions: true,
    onFunction() { return 'fn-1'; },
  });
  const decoded = c.decode(json, { onFunction(handle) {
    assert.equal(handle, 'fn-1');
    return original;
  } });
  assert.equal(decoded.fn, original);

  const promiseJson = c.encode({ thenable: Promise.resolve(1) }, {
    allowPromises: true,
    onPromise() { return 'p-1'; },
  });
  const promiseDecoded = c.decode(promiseJson, { onPromise(handle) {
    assert.equal(handle, 'p-1');
    return 'promise-placeholder';
  } });
  assert.equal(promiseDecoded.thenable, 'promise-placeholder');

  const error = new TypeError('nope');
  const errorJson = c.encodeData({ error });
  const errorDecoded = c.decodeData(errorJson);
  assert.equal(errorDecoded.error instanceof Error, true);
  assert.equal(errorDecoded.error.name, 'TypeError');
  assert.equal(errorDecoded.error.message, 'nope');

  assert.throws(() => c.encodeData({ fn: original }), /functions are not supported/);
  assert.throws(() => c.encodeData({ thenable: Promise.resolve(1) }), /Promises are not supported/);
});

test('What: unsupported and unbounded values fail closed with typed codes', () => {
  const c = codec({ limits: { maxDepth: 3, maxNodes: 20, maxString: 16, maxBytes: 512 } });
  const cases = [
    [undefined, /undefined is not supported/],
    [Symbol('s'), /symbol is not supported/],
    [10n, /bigint is not supported/],
    [Number.NaN, /non-finite/],
    [Infinity, /non-finite/],
    [new Date(), /plain objects/],
    [new Map(), /plain objects/],
    [new Set(), /plain objects/],
    [new Uint8Array(1), /plain objects/],
    [() => 1, /functions are not supported/],
    ['x'.repeat(17), /string exceeds/],
  ];
  for (const [value, pattern] of cases) {
    assert.throws(() => c.encodeData(value), pattern);
  }
  let getterCalls = 0;
  const accessor = {};
  Object.defineProperty(accessor, 'value', {
    enumerable: true,
    get() { getterCalls += 1; return 1; },
  });
  assert.throws(() => c.encodeData(accessor), /accessors are not supported/);
  assert.equal(getterCalls, 0);

  const cycle = {};
  cycle.self = cycle;
  assert.throws(() => c.encodeData(cycle), /cycles are not supported/);

  let deep = {};
  let cursor = deep;
  for (let index = 0; index < 5; index += 1) {
    cursor.next = {};
    cursor = cursor.next;
  }
  assert.throws(() => c.encodeData(deep), /depth limit/);

  let wide = {};
  for (let index = 0; index < 25; index += 1) wide[`k${index}`] = index;
  assert.throws(() => c.encodeData(wide), /node limit|byte limit/);

  const forbidden = JSON.parse('{"__proto__":{"polluted":true}}');
  assert.throws(() => c.encodeData(forbidden), /forbidden object key/);

  assert.throws(() => c.encodeData({ text: 'x'.repeat(1024) }), /byte limit|string exceeds/);
});

test('What: decoding rejects malformed nodes and handles', () => {
  const c = codec();
  const bad = [
    'not json',
    '[]',
    JSON.stringify({ v: 1 }),
    JSON.stringify({ t: 'num', v: '42' }),
    JSON.stringify({ t: 'bool', v: 'yes' }),
    JSON.stringify({ t: 'fn', h: '' }),
    JSON.stringify({ t: 'promise', h: 1 }),
    JSON.stringify({ t: 'mystery' }),
    JSON.stringify({ t: 'obj', v: [['__proto__', { t: 'num', v: 1 }]] }),
    JSON.stringify({ t: 'obj', v: [['ok']] }),
  ];
  for (const value of bad) assert.throws(() => c.decodeData(value), /invalid|forbidden|unknown|missing|number/i);
  assert.throws(() => c.decodeData('x'.repeat(70000)), /too large/);
});

test('What: encoded output never contains the HMAC secret', () => {
  const c = codec();
  const json = c.encodeData({ text: 'hello', nested: { value: 42 } });
  assert.equal(json.includes(secret), false);
  assert.equal(json.includes('secret'), false);
});

test('What: the helper message records and arrays are null-prototype', () => {
  const record = require('../fixtures/worlds/m0-cb-codec.js').makeRecord([['a', 1]]);
  assert.equal(Object.getPrototypeOf(record), null);
  assert.equal(record.a, 1);
  const array = makeArray();
  arrayPush(array, 1);
  arrayPush(array, 2);
  assert.equal(Object.getPrototypeOf(array), null);
  assert.equal(JSON.stringify(array), '[1,2]');
});

test('What: createCodec requires a bounded secret', () => {
  assert.throws(() => createCodec({}), /secret/);
  assert.throws(() => createCodec({ secret: 'short' }), /secret/);
});
