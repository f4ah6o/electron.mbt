'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../dist/core.cjs');
const { createIpcMain } = require('../bridges/node/ipc-main.cjs');
const { runScenario, channel } = require('../fixtures/ipc-handlers/scenario.cjs');

function setup(t) {
  const runtime = core.new_runtime();
  const call = operation => JSON.parse(core.dispatch(runtime, typeof operation === 'string' ? operation : JSON.stringify(operation)));
  const ipc = createIpcMain(core, runtime, name => () => { throw new Error(`unsupported ${name}`); });
  call('ready');
  const window = call({ op: 'window.reserve' }).window;
  call({ op: 'window.confirm', window });
  const generation = call({ op: 'window.navigate', window }).generation;
  call({ op: 'document.activate', window, generation, host_origin: 'file:///fixture/' });
  call({ op: 'grant', window, generation, channel });
  const sender = { window, generation, host_origin: 'file:///fixture/', main_frame: true };
  const event = { testOnly: true };
  t.after(() => ipc.dispose());
  return { ...ipc, runtime, call, sender, event, request: (...args) => ipc.invoke(sender, channel, args, event) };
}

test('the exact compiled kernel satisfies the shared 13-scenario handler contract', async t => {
  const ctx = setup(t);
  assert.equal((await runScenario(ctx.ipcMain, (channel, args) => ctx.invoke(ctx.sender, channel, args, ctx.event))).length, 13);
  assert.equal(ctx.call({ op: 'pending' }).pending, 0);
  assert.equal(ctx.call({ op: 'queued-bytes' }).bytes, 0);
});

test('handler registration works before ready without making a renderer grant', t => {
  const runtime = core.new_runtime();
  const ipc = createIpcMain(core, runtime, name => () => { throw new Error(name); });
  t.after(() => ipc.dispose());
  assert.equal(ipc.ipcMain.handle(channel, () => 1), undefined);
  assert.equal(JSON.parse(core.dispatch(runtime, 'state')).state, 'Booting');
  assert.throws(() => ipc.ipcMain.invoke({}, channel, []), /ipcMain.invoke/);
  assert.throws(() => ipc.ipcMain.reconcile(), /ipcMain.reconcile/);
});

for (const [label, change, code] of [
  ['child frame', sender => { sender.main_frame = false; }, 'Denied'],
  ['foreign origin', sender => { sender.host_origin = 'https://foreign.invalid'; }, 'Denied'],
  ['stale generation', sender => { sender.generation++; }, 'StaleDocument'],
  ['missing frame metadata', sender => { delete sender.main_frame; }, 'InvalidPayload'],
  ['fractional window', sender => { sender.window += 0.5; }, 'InvalidPayload'],
]) {
  test(`a ${label} cannot consume a once handler`, async t => {
    const ctx = setup(t);
    let calls = 0;
    ctx.ipcMain.handleOnce(channel, () => ++calls);
    const sender = { ...ctx.sender };
    change(sender);
    await assert.rejects(ctx.invoke(sender, channel, [], ctx.event), { code: `ELECTRON_MBT_CORE_${code}` });
    assert.equal(calls, 0);
    assert.equal(await ctx.request(), 1);
  });
}

test('an ungranted channel is denied whether or not a handler exists', async t => {
  const ctx = setup(t);
  ctx.ipcMain.handleOnce('ungranted', () => 1);
  for (const name of ['ungranted', 'missing']) {
    await assert.rejects(ctx.invoke(ctx.sender, name, [], ctx.event), { code: 'ELECTRON_MBT_CORE_Denied' });
  }
  ctx.call({ op: 'grant', ...ctx.sender, channel: 'ungranted' });
  assert.equal(await ctx.invoke(ctx.sender, 'ungranted', [], ctx.event), 1);
});

test('invalid argument values fail before consuming a once handler', async t => {
  const ctx = setup(t);
  ctx.ipcMain.handleOnce(channel, () => 1);
  for (const args of [[undefined], [new Date()], [() => {}], [{ get secret() { throw new Error('getter ran'); } }]]) {
    await assert.rejects(ctx.invoke(ctx.sender, channel, args, ctx.event), { code: 'ELECTRON_MBT_UNSUPPORTED_VALUE' });
  }
  await assert.rejects(ctx.invoke(ctx.sender, channel, ['x'.repeat(1048576)], ctx.event), { code: 'ELECTRON_MBT_LIMIT' });
  await assert.rejects(ctx.invoke(ctx.sender, channel, {}, ctx.event), { code: 'ELECTRON_MBT_INVALID_ARGUMENT' });
  assert.equal(await ctx.request(), 1);
});

test('128 handlers are bounded independently from listener registrations', t => {
  const ctx = setup(t);
  for (let index = 0; index < 128; index++) ctx.ipcMain.handle(`h${index}`, () => index);
  assert.throws(() => ctx.ipcMain.handle('extra', () => 1), { code: 'ELECTRON_MBT_CORE_LimitExceeded' });
  ctx.ipcMain.on('extra', () => {});
  ctx.ipcMain.removeHandler('h0');
  ctx.ipcMain.handle('extra', () => 1);
});

test('256 unsettled invocations apply backpressure and disposal rejects every one', async t => {
  const ctx = setup(t);
  ctx.ipcMain.handle(channel, () => new Promise(() => {}));
  const outcomes = Array.from({ length: 256 }, () => ctx.request().catch(error => error.code));
  await assert.rejects(ctx.request(), { code: 'ELECTRON_MBT_CORE_LimitExceeded' });
  assert.equal(ctx.call({ op: 'pending' }).pending, 256);
  ctx.dispose();
  assert.deepEqual(await Promise.all(outcomes), Array(256).fill('ELECTRON_MBT_CORE_InvalidState'));
  assert.equal(ctx.call({ op: 'pending' }).pending, 0);
  assert.equal(ctx.call({ op: 'queued-bytes' }).bytes, 0);
});

test('the existing queue byte budget also bounds unsettled handler inputs', async t => {
  const ctx = setup(t);
  ctx.ipcMain.handle(channel, () => new Promise(() => {}));
  const outcomes = Array.from({ length: 6 }, () => ctx.request('x'.repeat(600000)).catch(error => error.code));
  await assert.rejects(ctx.request('x'.repeat(600000)), { code: 'ELECTRON_MBT_CORE_LimitExceeded' });
  ctx.dispose();
  await Promise.all(outcomes);
  assert.equal(ctx.call({ op: 'queued-bytes' }).bytes, 0);
});

test('reconcile cancels never-settling work immediately after navigation', async t => {
  const ctx = setup(t);
  ctx.ipcMain.handle(channel, () => new Promise(() => {}));
  const outcome = ctx.request().catch(error => error.code);
  ctx.call({ op: 'window.navigate', window: ctx.sender.window });
  ctx.reconcile();
  assert.equal(await outcome, 'ELECTRON_MBT_CORE_AlreadyCompleted');
  assert.deepEqual(ctx.call({ op: 'cancellations.take' }).cancelled, []);
  assert.equal(ctx.call({ op: 'queued-bytes' }).bytes, 0);
});

test('late resolution after navigation is rejected even without an eager reconcile', async t => {
  const ctx = setup(t);
  const released = Promise.withResolvers();
  ctx.ipcMain.handle(channel, () => released.promise);
  const outcome = ctx.request().catch(error => error.code);
  ctx.call({ op: 'window.navigate', window: ctx.sender.window });
  released.resolve(42);
  assert.equal(await outcome, 'ELECTRON_MBT_CORE_AlreadyCompleted');
  assert.deepEqual(ctx.call({ op: 'cancellations.take' }).cancelled, []);
});

test('sender mutations cannot retarget an already admitted reply', async t => {
  const ctx = setup(t);
  const released = Promise.withResolvers();
  ctx.ipcMain.handle(channel, () => released.promise);
  const outcome = ctx.request();
  ctx.sender.window = 999;
  ctx.sender.generation = 999;
  ctx.sender.host_origin = 'https://foreign.invalid';
  released.resolve(42);
  assert.equal(await outcome, 42);
});

for (const op of ['window.destroy', 'stop']) {
  test(`${op} followed by reconcile rejects pending promises without a handler timeout`, async t => {
    const ctx = setup(t);
    ctx.ipcMain.handle(channel, () => new Promise(() => {}));
    const outcome = ctx.request().catch(error => error.code);
    ctx.call(op === 'stop' ? 'stop' : { op, window: ctx.sender.window });
    ctx.reconcile();
    assert.equal(await outcome, 'ELECTRON_MBT_CORE_AlreadyCompleted');
    assert.equal(ctx.call({ op: 'pending' }).pending, 0);
  });
}

test('unsupported results reject and release request accounting', async t => {
  const ctx = setup(t);
  for (const value of [undefined, new Date(), new Map(), -0]) {
    ctx.ipcMain.handleOnce(channel, () => value);
    await assert.rejects(ctx.request(), { code: 'ELECTRON_MBT_UNSUPPORTED_VALUE' });
    assert.equal(ctx.call({ op: 'pending' }).pending, 0);
    assert.equal(ctx.call({ op: 'queued-bytes' }).bytes, 0);
  }
});

test('handler error replies retain only a bounded message without invoking error accessors', async t => {
  const ctx = setup(t);
  const thrown = new Error('expected-message');
  thrown.secret = 'private';
  ctx.ipcMain.handleOnce(channel, () => { throw thrown; });
  await assert.rejects(ctx.request(), error => error.message === 'expected-message' && error.secret === undefined && error !== thrown);
  let reads = 0;
  ctx.ipcMain.handleOnce(channel, () => { throw { get message() { reads++; return 'leak'; } }; });
  await assert.rejects(ctx.request(), { message: 'Handler failed' });
  assert.equal(reads, 0);
  ctx.ipcMain.handleOnce(channel, () => { throw new Error('x'.repeat(2048)); });
  await assert.rejects(ctx.request(), error => error.message.length === 1024);
});

test('concurrent calls consume a once handler before its promise resolves', async t => {
  const ctx = setup(t);
  const released = Promise.withResolvers();
  ctx.ipcMain.handleOnce(channel, () => released.promise);
  const first = ctx.request();
  await assert.rejects(ctx.request(), { code: 'ELECTRON_MBT_CORE_UnknownHandler' });
  released.resolve(42);
  assert.equal(await first, 42);
});

test('cancelled close and cancelled quit preserve still-valid calls', async t => {
  const ctx = setup(t);
  const released = Promise.withResolvers();
  ctx.ipcMain.handle(channel, () => released.promise);
  const first = ctx.request();
  ctx.call({ op: 'window.begin-close', window: ctx.sender.window });
  ctx.call({ op: 'window.cancel-close', window: ctx.sender.window });
  ctx.call('begin-quit');
  ctx.call('cancel-quit');
  ctx.reconcile();
  released.resolve(42);
  assert.equal(await first, 42);
});

for (const operation of [
  { op: 'register', channel, once: false },
  { op: 'register', channel, once: 0, callable: true },
  { op: 'remove', channel: null },
  { op: 'finish', request: 0.5 },
  { op: 'finish', request: 2147483648 },
  { op: 'cancel', request: '1' },
  { op: 'begin' },
]) {
  test(`the compiled handler boundary rejects ${JSON.stringify(operation)}`, () => {
    const registry = core.new_invokes(core.new_runtime());
    assert.deepEqual(JSON.parse(core.dispatch_invokes(registry, JSON.stringify(operation))), { ok: false, code: 'InvalidPayload' });
    assert.deepEqual(JSON.parse(core.dispatch_invokes(registry, '{"op":"stats"}')), { ok: true, handlers: 0, invocations: 0 });
  });
}

test('malformed and oversized handler envelopes fail without mutation', () => {
  const registry = core.new_invokes(core.new_runtime());
  for (const raw of ['{', ' '.repeat(16384) + '{}']) {
    assert.deepEqual(JSON.parse(core.dispatch_invokes(registry, raw)), { ok: false, code: 'InvalidPayload' });
  }
});
