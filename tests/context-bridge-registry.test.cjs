'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const raw = require('../dist/core.cjs');
const { bindContextBridgeCore } = require('../bridges/node/context-bridge-registry.cjs');
const core = bindContextBridgeCore(raw);
const revoked = { code: 'ELECTRON_MBT_BRIDGE_REVOKED' };
function command(runtime, value) {
  return JSON.parse(raw.context_bridge_dispatch(runtime, JSON.stringify(value)));
}
function ok(value) { const result = JSON.parse(value); assert.equal(result.ok, true, JSON.stringify(result)); return result; }
function activate(runtime, window, generation) {
  const scope = { window: String(window), generation: String(generation), origin: 'file:///fixture/', mainFrame: true, channel: 'read-text' };
  assert.deepEqual(command(runtime, { op: 'activate', window: scope.window, generation: scope.generation, origin: scope.origin }), { ok: true });
  assert.deepEqual(command(runtime, { op: 'grant', window: scope.window, generation: scope.generation, channel: scope.channel }), { ok: true });
  return scope;
}
function windowFixture(runtime) {
  const window = ok(core.window_reserve(runtime)).id;
  ok(core.window_confirm(runtime, window));
  const generation = ok(core.window_navigate(runtime, window)).generation;
  return activate(runtime, window, generation);
}
function fixture() {
  const runtime = core.new_runtime();
  ok(core.dispatch(runtime, 'ready'));
  const scope = windowFixture(runtime);
  return { runtime, scope, registry: core.context_registry(runtime) };
}
function count(runtime, registry, expected) {
  assert.equal(raw.context_bridge_count(runtime), expected);
  assert.equal(registry.retainedCount, expected);
}

test('compiled bridge rejects missing fields unknown operations and non-flat metadata', () => {
  const { runtime, scope } = fixture();
  const valid = { op: 'register', ...scope, kind: 'function' };
  for (const key of Object.keys(valid)) {
    const value = { ...valid }; delete value[key];
    assert.equal(command(runtime, value).ok, false, key);
  }
  for (const value of [null, [], {}, { ...valid, op: 'exposeInMainWorld' },
    { ...valid, extra: true }, { ...valid, mainFrame: 'true' },
    { ...valid, mainFrame: null }, { ...valid, kind: 'constructor' },
    { ...valid, origin: {} }, { ...valid, channel: [] }]) {
    assert.equal(command(runtime, value).ok, false);
  }
  for (const value of ['{', '{"op":', '['.repeat(300) + ']'.repeat(300),
    '{"op":"' + 'x'.repeat(2048) + '"}']) {
    assert.equal(JSON.parse(raw.context_bridge_dispatch(runtime, value)).ok, false);
  }
  assert.equal(raw.context_bridge_count(runtime), 0);
});

test('compiled bridge rejects numeric and noncanonical IDs before JS integer coercion', () => {
  const { runtime, scope } = fixture();
  const valid = { op: 'register', ...scope, kind: 'function' };
  for (const key of ['window', 'generation']) {
    for (const value of [1, 1.5, 4294967297, null, true, '', '0', '-0', '-1', '01', '+1', '1.0', '1e0', '1.00000000000000001', '2147483648']) {
      assert.equal(command(runtime, { ...valid, [key]: value }).ok, false, key + ':' + value);
    }
  }
  assert.equal(raw.context_bridge_count(runtime), 0);
  assert.equal(command(runtime, valid).id, 1);
});

test('JS registry preserves synchronous values throws and source function closure state', () => {
  const { runtime, scope, registry } = fixture();
  let calls = 0;
  const id = registry.retainFunction(scope, value => { calls++; return { result: value + calls }; });
  const result = registry.invoke(scope, id, [4]);
  assert.deepEqual(result, { result: 5 });
  assert.equal(result instanceof Promise, false);
  assert.deepEqual(registry.invoke(scope, id, [4]), { result: 6 });
  const error = new Error('same-realm error');
  const throwing = registry.retainFunction(scope, () => { throw error; });
  assert.throws(() => registry.invoke(scope, throwing), candidate => candidate === error);
  count(runtime, registry, 2);
});

test('scope snapshots cannot be mutated into another handle authority', () => {
  const { scope, registry } = fixture();
  const id = registry.retainFunction(scope, () => 'allowed');
  scope.origin = 'https://attacker.invalid';
  assert.throws(() => registry.invoke(scope, id), { code: 'ELECTRON_MBT_Denied' });
  scope.origin = 'file:///fixture/';
  assert.equal(registry.invoke(scope, id), 'allowed');
});

test('metadata getters toJSON and proxies are rejected without executing them', () => {
  const { runtime, scope, registry } = fixture();
  let touched = 0;
  const getter = { ...scope }; Object.defineProperty(getter, 'origin', { enumerable: true, get() { touched++; return scope.origin; } });
  for (const value of [getter, { ...scope, toJSON() { touched++; return scope; } },
    new Proxy(scope, { ownKeys() { touched++; return Reflect.ownKeys(scope); } })]) {
    assert.throws(() => registry.retainFunction(value, () => null));
  }
  assert.equal(touched, 0);
  count(runtime, registry, 0);
});

test('every invocation release and settlement rejects foreign origin frame channel and document', async () => {
  const { runtime, scope, registry } = fixture();
  let invoked = 0;
  const id = registry.retainFunction(scope, () => { invoked++; });
  const pending = registry.createPromise(scope);
  const other = windowFixture(runtime);
  for (const candidate of [{ ...scope, origin: 'https://attacker.invalid' }, { ...scope, mainFrame: false },
    { ...scope, generation: '2' }, { ...scope, channel: 'write-text' }, other]) {
    assert.throws(() => registry.invoke(candidate, id));
    assert.throws(() => registry.release(candidate, id, 'function'));
    assert.throws(() => registry.settlePromise(candidate, pending.id, true, 'bad'));
  }
  assert.equal(invoked, 0);
  count(runtime, registry, 2);
  registry.settlePromise(scope, pending.id, true, 'good');
  assert.equal(await pending.promise, 'good');
});

test('same-origin separately granted channels cannot borrow a live function', () => {
  const { runtime, scope, registry } = fixture();
  command(runtime, { op: 'grant', window: scope.window, generation: scope.generation, channel: 'write-text' });
  const id = registry.retainFunction(scope, () => 'secret');
  assert.throws(() => registry.invoke({ ...scope, channel: 'write-text' }, id), { code: 'ELECTRON_MBT_Denied' });
  assert.equal(registry.invoke(scope, id), 'secret');
});

test('callback registration preserves each explicit handle without assuming inter-call identity', () => {
  const { scope, registry } = fixture();
  const received = [];
  const callback = value => { received.push(value); };
  const first = registry.retainFunction(scope, callback, 'callback');
  const second = registry.retainFunction(scope, callback, 'callback');
  assert.notEqual(first, second);
  assert.throws(() => registry.invoke(scope, first, ['wrong']), { code: 'ELECTRON_MBT_Denied' });
  registry.invoke(scope, first, ['first'], 'callback');
  assert.equal(registry.release(scope, first, 'callback'), true);
  assert.equal(registry.release(scope, first, 'callback'), false);
  assert.throws(() => registry.invoke(scope, first, ['late'], 'callback'));
  registry.invoke(scope, second, ['second'], 'callback');
  assert.deepEqual(received, ['first', 'second']);
});

test('nested synchronous calls use the live registry and release during invocation rejects stale output', () => {
  const { runtime, scope, registry } = fixture();
  const inner = registry.retainFunction(scope, value => value + 1);
  const outer = registry.retainFunction(scope, value => registry.invoke(scope, inner, [value]) + 1);
  assert.equal(registry.invoke(scope, outer, [40]), 42);
  let self;
  self = registry.retainFunction(scope, () => { registry.release(scope, self, 'function'); return 'stale'; });
  assert.throws(() => registry.invoke(scope, self), { code: 'ELECTRON_MBT_UnknownBridgeHandle' });
  count(runtime, registry, 2);
});

test('reentrant navigation rejects both stale synchronous returns and stale throws', () => {
  for (const throws of [false, true]) {
    const { runtime, scope, registry } = fixture();
    const id = registry.retainFunction(scope, () => {
      ok(core.window_navigate(runtime, Number(scope.window)));
      if (throws) throw new Error('retired document');
      return 'retired document';
    });
    assert.throws(() => registry.invoke(scope, id), { code: 'ELECTRON_MBT_InvalidState' });
    count(runtime, registry, 0);
  }
});

test('function inputs and returns remain a narrow JSON leaf instead of pretending to marshal functions or promises', () => {
  const { scope, registry } = fixture();
  let calls = 0;
  const id = registry.retainFunction(scope, () => { calls++; return Promise.resolve('unsupported'); });
  assert.throws(() => registry.invoke(scope, id), { code: 'ELECTRON_MBT_UNSUPPORTED_VALUE' });
  assert.throws(() => registry.invoke(scope, id, [() => {}]), { code: 'ELECTRON_MBT_UNSUPPORTED_VALUE' });
  assert.equal(calls, 1);
});

test('Promise fulfillment and rejection consume both registries exactly once', async () => {
  const { runtime, scope, registry } = fixture();
  for (const fulfilled of [true, false]) {
    const pending = registry.createPromise(scope);
    const observed = pending.promise.then(value => ({ fulfilled: true, value }), value => ({ fulfilled: false, value }));
    registry.settlePromise(scope, pending.id, fulfilled, 'result');
    count(runtime, registry, 0);
    assert.throws(() => registry.settlePromise(scope, pending.id, !fulfilled, 'duplicate'));
    assert.deepEqual(await observed, { fulfilled, value: 'result' });
  }
});

test('thenables and getters cannot run after consuming a Promise handle', async () => {
  const { runtime, scope, registry } = fixture();
  const pending = registry.createPromise(scope);
  let touched = 0;
  for (const value of [{ then() { touched++; } }, { get then() { touched++; return () => {}; } },
    new Proxy({}, { ownKeys() { touched++; return []; } })]) {
    assert.throws(() => registry.settlePromise(scope, pending.id, true, value));
    count(runtime, registry, 1);
  }
  assert.equal(touched, 0);
  registry.settlePromise(scope, pending.id, true, null);
  assert.equal(await pending.promise, null);
});

test('explicit Promise release rejects it and repeated disposal stays idempotent', async () => {
  const { runtime, scope, registry } = fixture();
  const pending = registry.createPromise(scope);
  const observed = assert.rejects(pending.promise, revoked);
  assert.equal(registry.release(scope, pending.id, 'promise'), true);
  assert.equal(registry.release(scope, pending.id, 'promise'), false);
  await observed;
  count(runtime, registry, 0);
});

test('navigation automatically rejects pending Promises and removes callable references', async () => {
  const { runtime, scope, registry } = fixture();
  const id = registry.retainFunction(scope, () => 'old');
  const pending = registry.createPromise(scope);
  const observed = assert.rejects(pending.promise, revoked);
  const next = ok(core.window_navigate(runtime, Number(scope.window))).generation;
  await observed;
  count(runtime, registry, 0);
  const fresh = activate(runtime, Number(scope.window), next);
  assert.throws(() => registry.invoke(fresh, id));
  assert.throws(() => registry.settlePromise(fresh, pending.id, true, 'late'));
  assert.ok(registry.retainFunction(fresh, () => 'new') > pending.id);
});

test('same-generation invalidation removes JS entries before a new activation', async () => {
  const { runtime, scope, registry } = fixture();
  const pending = registry.createPromise(scope);
  const observed = assert.rejects(pending.promise, revoked);
  ok(core.window_invalidate(runtime, Number(scope.window), Number(scope.generation)));
  activate(runtime, Number(scope.window), Number(scope.generation));
  await observed;
  assert.throws(() => registry.settlePromise(scope, pending.id, true, 'stale'));
  count(runtime, registry, 0);
});

test('destroy removes only the selected window and stop rejects the remaining Promise', async () => {
  const { runtime, scope, registry } = fixture();
  const other = windowFixture(runtime);
  const first = registry.createPromise(scope);
  const kept = registry.createPromise(other);
  const observedFirst = assert.rejects(first.promise, revoked);
  const observedKept = assert.rejects(kept.promise, revoked);
  assert.equal(core.window_destroy(runtime, Number(scope.window)), true);
  await observedFirst;
  count(runtime, registry, 1);
  ok(core.dispatch(runtime, 'stop'));
  await observedKept;
  count(runtime, registry, 0);
});

test('cancelled close and quit pause use without dropping valid JS entries', async () => {
  const { runtime, scope, registry } = fixture();
  const id = registry.retainFunction(scope, () => 42);
  const pending = registry.createPromise(scope);
  ok(core.window_begin_close(runtime, Number(scope.window)));
  assert.throws(() => registry.invoke(scope, id), { code: 'ELECTRON_MBT_InvalidState' });
  count(runtime, registry, 2);
  ok(core.window_cancel_close(runtime, Number(scope.window)));
  assert.equal(registry.invoke(scope, id), 42);
  ok(core.dispatch(runtime, 'begin-quit'));
  assert.throws(() => registry.settlePromise(scope, pending.id, true, 42), { code: 'ELECTRON_MBT_InvalidState' });
  count(runtime, registry, 2);
  ok(core.dispatch(runtime, 'cancel-quit'));
  registry.settlePromise(scope, pending.id, true, 42);
  assert.equal(await pending.promise, 42);
});

test('failed lifecycle transitions do not spuriously release current records', () => {
  const { runtime, scope, registry } = fixture();
  const id = registry.retainFunction(scope, () => 42);
  assert.equal(JSON.parse(core.window_invalidate(runtime, Number(scope.window), 999)).ok, false);
  assert.equal(core.window_destroy(runtime, 999), false);
  assert.equal(registry.invoke(scope, id), 42);
  count(runtime, registry, 1);
});

test('the MoonBit quota bounds mixed JS references and releases restore capacity', () => {
  const { runtime, scope, registry } = fixture();
  const ids = [];
  for (let i = 0; i < 256; i++) ids.push(registry.retainFunction(scope, () => i));
  assert.throws(() => registry.createPromise(scope), { code: 'ELECTRON_MBT_LimitExceeded' });
  count(runtime, registry, 256);
  registry.release(scope, ids[0], 'function');
  const next = registry.retainFunction(scope, () => null);
  assert.ok(next > ids.at(-1));
  count(runtime, registry, 256);
  ok(core.dispatch(runtime, 'stop'));
  count(runtime, registry, 0);
});

test('registries are runtime-scoped even when numeric IDs coincide', () => {
  const left = fixture(); const right = fixture();
  const id = left.registry.retainFunction(left.scope, () => 'left');
  assert.throws(() => right.registry.invoke(right.scope, id));
  const otherId = right.registry.retainFunction(right.scope, () => 'right');
  assert.equal(otherId, id);
  assert.equal(left.registry.invoke(left.scope, id), 'left');
  assert.equal(right.registry.invoke(right.scope, id), 'right');
  assert.equal(bindContextBridgeCore(raw).context_registry(left.runtime), left.registry);
});

test('reconciliation also removes records after a trusted caller used the raw core', async () => {
  const { runtime, scope, registry } = fixture();
  const pending = registry.createPromise(scope);
  const observed = assert.rejects(pending.promise, revoked);
  ok(raw.window_invalidate(runtime, Number(scope.window), Number(scope.generation)));
  assert.equal(registry.reconcile(), 1);
  await observed;
  count(runtime, registry, 0);
});
