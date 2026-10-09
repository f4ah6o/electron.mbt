'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { encodeTiny, decodeTiny } = require('../bridges/node/clone.cjs');
test('tiny values round-trip without losing object keys or Unicode', () => {
  const value = JSON.parse('{"__proto__":{"polluted":true},"text":"日本語","array":[1,true,null]}');
  const result = decodeTiny(Buffer.from(encodeTiny(value)));
  assert.deepEqual(result, value);
  assert.equal({}.polluted, undefined);
});
test('unsupported structured-clone values fail rather than become JSON lookalikes', () => {
  const shared = {};
  const cyclic = {}; cyclic.self = cyclic;
  for (const value of [undefined, NaN, Infinity, -0, 1n, new Date(), new Map(), new Set(), new Uint8Array(1), new Error(), /x/, () => {}, Symbol(), [undefined], [,1], { a: undefined }, cyclic, [shared, shared]]) {
    assert.throws(() => encodeTiny(value), { code: 'ELECTRON_MBT_UNSUPPORTED_VALUE' });
  }
});
test('getters and toJSON are never invoked by the codec', () => {
  let calls = 0;
  const getter = Object.defineProperty({}, 'x', { enumerable: true, get() { calls++; return 1; } });
  const custom = { toJSON() { calls++; return {}; } };
  assert.throws(() => encodeTiny(getter));
  assert.throws(() => encodeTiny(custom));
  assert.equal(calls, 0);
});
test('depth nodes and encoded bytes are bounded', () => {
  let value = null;
  for (let i = 0; i < 65; i++) value = [value];
  assert.throws(() => encodeTiny(value), { code: 'ELECTRON_MBT_LIMIT' });
  assert.throws(() => decodeTiny(Buffer.from('['.repeat(1000) + '0' + ']'.repeat(1000))), { code: 'ELECTRON_MBT_LIMIT' });
  assert.throws(() => encodeTiny('あ'.repeat(350000)), { code: 'ELECTRON_MBT_LIMIT' });
  assert.throws(() => encodeTiny(Array(100001).fill(null)), { code: 'ELECTRON_MBT_LIMIT' });
});
test('invalid encoding syntax and extra array properties fail explicitly', () => {
  assert.throws(() => decodeTiny(Buffer.from([0xff])), { code: 'ELECTRON_MBT_INVALID_PAYLOAD' });
  assert.throws(() => decodeTiny(Buffer.from('{')), { code: 'ELECTRON_MBT_INVALID_PAYLOAD' });
  const array = [1]; array.extra = 2;
  assert.throws(() => encodeTiny(array), { code: 'ELECTRON_MBT_UNSUPPORTED_VALUE' });
});

test('proxy traps and aggregate string growth cannot bypass the codec boundary', () => {
  let traps = 0;
  const proxy = new Proxy({}, { ownKeys() { traps++; return []; } });
  assert.throws(() => encodeTiny(proxy), { code: 'ELECTRON_MBT_UNSUPPORTED_VALUE' });
  assert.equal(traps, 0);
  assert.throws(() => encodeTiny(Array(100).fill('x'.repeat(500000))), { code: 'ELECTRON_MBT_LIMIT' });
});

test('a wide object is limited before descriptors can exhaust a small Node heap', () => {
  const source = [
    "const { encodeTiny } = require('./bridges/node/clone.cjs');",
    'const value = Object.create(null);',
    'for (let index = 0; index < 500000; index++) value[`key${index}`] = null;',
    'try { encodeTiny(value); process.exitCode = 2; }',
    'catch (error) { if (error.code !== \'ELECTRON_MBT_LIMIT\') throw error; process.stdout.write(error.code); }'
  ].join('\n');
  const result = spawnSync(process.execPath, ['--max-old-space-size=64', '-e', source], {
    cwd: require('node:path').resolve(__dirname, '..'), encoding: 'utf8', timeout: 30000
  });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, 'ELECTRON_MBT_LIMIT');
});
