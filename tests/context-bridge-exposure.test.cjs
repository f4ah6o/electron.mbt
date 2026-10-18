'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const raw = require('../dist/core.cjs');
const { bindContextBridgeCore } = require('../bridges/node/context-bridge-registry.cjs');
const core = bindContextBridgeCore(raw);
const SHA = 'a'.repeat(64);

function command(runtime, value) {
  return JSON.parse(raw.context_bridge_dispatch(runtime, JSON.stringify(value)));
}
function ok(value) {
  const result = typeof value === 'string' ? JSON.parse(value) : value;
  assert.equal(result.ok, true, JSON.stringify(result));
  return result;
}
function fixture() {
  const runtime = core.new_runtime();
  ok(core.dispatch(runtime, 'ready'));
  const window = ok(core.window_reserve(runtime)).id;
  ok(core.window_confirm(runtime, window));
  const generation = ok(core.window_navigate(runtime, window)).generation;
  const scope = {
    window: String(window), generation: String(generation),
    origin: 'file:///fixture/', mainFrame: true, channel: 'read-text',
  };
  ok(command(runtime, { op: 'activate', window: scope.window, generation: scope.generation, origin: scope.origin }));
  ok(command(runtime, { op: 'grant', window: scope.window, generation: scope.generation, channel: scope.channel }));
  return { runtime, scope };
}
function exposed(scope, overrides) {
  return Object.assign({
    op: 'expose', ...scope, apiKey: 'fixture', descriptorBytes: 128,
    functionCount: 2, descriptorSha256: SHA,
  }, overrides || {});
}
function release(scope, overrides) {
  return Object.assign({
    op: 'release-exposure', ...scope, id: '1', apiKey: 'fixture',
  }, overrides || {});
}

test('What: a valid exposure is bounded by MoonBit and releases once', () => {
  const { runtime, scope } = fixture();
  const first = command(runtime, exposed(scope));
  assert.equal(first.ok, true);
  assert.equal(first.id, 1);
  assert.equal(raw.context_bridge_exposure_count(runtime), 1);
  assert.deepEqual(command(runtime, release(scope)), { ok: true, released: true });
  assert.equal(raw.context_bridge_exposure_count(runtime), 0);
  assert.deepEqual(command(runtime, release(scope)), { ok: true, released: false });
  const second = command(runtime, exposed(scope));
  assert.equal(second.ok, true);
  assert.ok(second.id > first.id);
});

test('What: malformed exposure metadata is rejected before allocation', () => {
  const { runtime, scope } = fixture();
  const valid = exposed(scope);
  for (const key of Object.keys(valid)) {
    const value = { ...valid };
    delete value[key];
    assert.equal(command(runtime, value).ok, false, `missing ${key}`);
  }
  const invalid = [
    { ...valid, extra: true },
    { ...valid, mainFrame: 'true' },
    { ...valid, descriptorBytes: '128' },
    { ...valid, functionCount: 1.5 },
    { ...valid, functionCount: 257 },
    { ...valid, descriptorBytes: 0 },
    { ...valid, descriptorSha256: 'A'.repeat(64) },
    { ...valid, descriptorSha256: 'a'.repeat(63) },
    { ...valid, apiKey: 'window' },
    { ...valid, apiKey: '__proto__' },
    { ...valid, apiKey: 'line\nbreak' },
    { ...valid, apiKey: {} },
    { op: 'exposeInMainWorld' },
    null,
    [],
  ];
  for (const value of invalid) assert.equal(command(runtime, value).ok, false, JSON.stringify(value));
  assert.equal(raw.context_bridge_exposure_count(runtime), 0);
});

test('What: duplicate exposure keys and untrusted authority fail closed', () => {
  const { runtime, scope } = fixture();
  assert.equal(command(runtime, exposed(scope)).ok, true);
  const duplicate = command(runtime, exposed(scope));
  assert.equal(duplicate.ok, false);
  assert.equal(duplicate.code, 'Denied');
  for (const overrides of [
    { origin: 'https://attacker.invalid' },
    { mainFrame: false },
    { channel: 'ungranted' },
    { generation: String(Number(scope.generation) + 1) },
  ]) {
    assert.equal(command(runtime, exposed(scope, overrides)).ok, false, JSON.stringify(overrides));
  }
  assert.equal(raw.context_bridge_exposure_count(runtime), 1);
});

test('What: navigation revokes exposures and stale IDs fail closed', () => {
  const { runtime, scope } = fixture();
  assert.equal(command(runtime, exposed(scope)).ok, true);
  const generation = ok(core.window_navigate(runtime, Number(scope.window))).generation;
  assert.equal(raw.context_bridge_exposure_count(runtime), 0);
  const nextScope = { ...scope, generation: String(generation) };
  ok(command(runtime, { op: 'activate', window: nextScope.window, generation: nextScope.generation, origin: nextScope.origin }));
  ok(command(runtime, { op: 'grant', window: nextScope.window, generation: nextScope.generation, channel: nextScope.channel }));
  const stale = command(runtime, release(scope));
  assert.equal(stale.ok, false);
  assert.equal(stale.code, 'StaleDocument');
  const unknown = command(runtime, release(nextScope));
  assert.equal(unknown.ok, true);
  assert.equal(unknown.released, false);
});
