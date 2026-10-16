'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../dist/core.cjs');
const { createIpcMain } = require('../bridges/node/ipc-main.cjs');
const { runScenario } = require('../fixtures/ipc-listeners/scenario.cjs');

function setup() {
  const runtime = core.new_runtime();
  const unsupported = name => () => {
    const error = new Error(`${name} is not implemented`);
    error.code = 'ELECTRON_MBT_UNSUPPORTED_API';
    throw error;
  };
  return { runtime, ...createIpcMain(core, runtime, unsupported) };
}
function dispatch(runtime, operation) {
  return JSON.parse(core.dispatch(runtime, JSON.stringify(operation)));
}

test('ordinary listener behavior matches the shared Electron scenario', () => {
  const { ipcMain } = setup();
  assert.equal(runScenario(ipcMain).length, 12);
});

test('capacity spans all channels and removal releases it without losing callbacks', () => {
  const { ipcMain } = setup();
  const fn = () => {};
  for (let index = 0; index < 256; index++) ipcMain.on(`channel-${index}`, fn);
  assert.throws(() => ipcMain.once('extra', fn), { code: 'ELECTRON_MBT_CORE_LimitExceeded' });
  ipcMain.off('channel-0', fn);
  ipcMain.once('extra', fn);
  assert.equal(ipcMain.emit('extra'), true);
  assert.equal(ipcMain.emit('extra'), false);
  ipcMain.on('reclaimed', fn);
  ipcMain.removeAllListeners();
  assert.equal(ipcMain.listenerCount('reclaimed'), 0);
  for (let index = 0; index < 256; index++) ipcMain.on('new', fn);
  assert.equal(ipcMain.listenerCount('new'), 256);
});

for (const [label, channel, code] of [
  ['non-string', 42, 'ELECTRON_MBT_INVALID_ARGUMENT'],
  ['symbol', Symbol('channel'), 'ELECTRON_MBT_INVALID_ARGUMENT'],
  ['lone surrogate', '\ud800', 'ELECTRON_MBT_INVALID_ARGUMENT'],
  ['empty', '', 'ELECTRON_MBT_CORE_InvalidPayload'],
  ['oversized', 'x'.repeat(129), 'ELECTRON_MBT_CORE_LimitExceeded'],
  ['error event', 'error', 'ELECTRON_MBT_CORE_Denied'],
  ['newListener event', 'newListener', 'ELECTRON_MBT_CORE_Denied'],
  ['removeListener event', 'removeListener', 'ELECTRON_MBT_CORE_Denied'],
]) {
  test(`a ${label} channel is rejected without registering a callback`, () => {
    const { ipcMain } = setup();
    assert.throws(() => ipcMain.on(channel, () => {}), { code });
    assert.throws(() => ipcMain.emit(channel), { code });
    assert.throws(() => ipcMain.removeAllListeners(channel), { code });
    assert.equal(ipcMain.listenerCount('valid'), 0);
  });
}

test('invalid callbacks are rejected without consuming capacity', () => {
  const { ipcMain } = setup();
  for (const value of [null, undefined, 0, {}, 'function']) {
    assert.throws(() => ipcMain.on('valid', value), { code: 'ELECTRON_MBT_INVALID_ARGUMENT' });
    assert.throws(() => ipcMain.once('valid', value), { code: 'ELECTRON_MBT_INVALID_ARGUMENT' });
    assert.throws(() => ipcMain.off('valid', value), { code: 'ELECTRON_MBT_INVALID_ARGUMENT' });
  }
  assert.equal(ipcMain.listenerCount('valid'), 0);
});

test('prototype-like and Unicode channel names are distinct ordinary channels', () => {
  const { ipcMain } = setup();
  for (const channel of ['__proto__', 'constructor', 'toString', '日本語🌙', 'x'.repeat(128)]) {
    let count = 0;
    ipcMain.once(channel, () => count++);
    assert.equal(ipcMain.emit(channel), true);
    assert.equal(count, 1);
    assert.equal(ipcMain.emit(channel), false);
  }
});

test('registries and callback identities are isolated between runtimes', () => {
  const first = setup();
  const second = setup();
  let count = 0;
  first.ipcMain.on('channel', () => count++);
  assert.equal(second.ipcMain.emit('channel'), false);
  assert.equal(first.ipcMain.emit('channel'), true);
  assert.equal(count, 1);
});

test('dispose releases callbacks and all further operations fail closed', () => {
  const { runtime, ipcMain, dispose } = setup();
  ipcMain.on('channel', () => {});
  core.dispatch(runtime, 'stop');
  dispose();
  assert.throws(() => ipcMain.on('channel', () => {}), { code: 'ELECTRON_MBT_CORE_InvalidState' });
  assert.throws(() => ipcMain.emit('channel'), { code: 'ELECTRON_MBT_CORE_InvalidState' });
  assert.throws(() => ipcMain.rawListeners('channel'), { code: 'ELECTRON_MBT_CORE_InvalidState' });
});

test('undeclared emitter and host controller methods remain explicit failures', () => {
  const { ipcMain } = setup();
  for (const method of ['prependListener', 'setMaxListeners', 'eventNames', 'invoke', 'reconcile']) {
    assert.throws(() => ipcMain[method]('channel', () => {}), { code: 'ELECTRON_MBT_UNSUPPORTED_API' });
  }
});

for (const operation of [
  { op: 'ipc.listeners.add' },
  { op: 'ipc.listeners.add', channel: null },
  { op: 'ipc.listeners.snapshot', channel: true },
  { op: 'ipc.listeners.clear-channel', channel: [] },
  { op: 'ipc.listeners.remove' },
  { op: 'ipc.listeners.remove', listener: 1.5 },
  { op: 'ipc.listeners.remove', listener: 2147483648 },
  { op: 'ipc.listeners.remove', listener: '1' },
]) {
  test(`the compiled listener boundary rejects ${JSON.stringify(operation)}`, () => {
    const { runtime } = setup();
    assert.deepEqual(dispatch(runtime, operation), { ok: false, code: 'InvalidPayload' });
    assert.deepEqual(dispatch(runtime, { op: 'ipc.listeners.snapshot', channel: 'valid' }), { ok: true, listeners: [] });
  });
}

test('the compiled boundary owns capacity and snapshot ids without a JS facade', () => {
  const { runtime } = setup();
  for (let id = 1; id <= 256; id++) {
    assert.deepEqual(dispatch(runtime, { op: 'ipc.listeners.add', channel: 'channel' }), { ok: true, listener: id });
  }
  assert.deepEqual(dispatch(runtime, { op: 'ipc.listeners.add', channel: 'other' }), { ok: false, code: 'LimitExceeded' });
  assert.deepEqual(dispatch(runtime, { op: 'ipc.listeners.remove', listener: 1 }), { ok: true, removed: true });
  assert.deepEqual(dispatch(runtime, { op: 'ipc.listeners.add', channel: 'other' }), { ok: true, listener: 257 });
  assert.deepEqual(dispatch(runtime, { op: 'ipc.listeners.snapshot', channel: 'other' }), { ok: true, listeners: [257] });
  assert.deepEqual(dispatch(runtime, { op: 'ipc.listeners.remove', listener: 1 }), { ok: true, removed: false });
  assert.deepEqual(JSON.parse(core.dispatch(runtime, ' '.repeat(16384) + '{"op":"ipc.listeners.add","channel":"x"}')), { ok: false, code: 'InvalidPayload' });
});
