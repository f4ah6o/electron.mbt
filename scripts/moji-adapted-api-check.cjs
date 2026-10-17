'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const adapterPath = path.join(root, 'fixtures/moji-adapted/page-api.js');

function createHost() {
  const calls = [];
  const readyCallbacks = [];
  let emitter = null;
  return {
    calls,
    whenReady(callback) { readyCallbacks.push(callback); },
    dispatch(operation, args) {
      calls.push({ operation, args });
      return { operation, args };
    },
    onEvent(callback) { emitter = callback; },
    ready() {
      const batch = readyCallbacks.splice(0, readyCallbacks.length);
      for (const callback of batch) callback();
    },
    emit(topic, payload) {
      if (!emitter) throw new Error('event emitter was not installed');
      emitter(topic, payload);
    },
  };
}

function load(host) {
  const source = fs.readFileSync(adapterPath, 'utf8');
  const window = {};
  const context = vm.createContext({ window, TextEncoder, setTimeout, clearTimeout });
  if (host) window.__electronMbtIngress = host;
  vm.runInContext(source, context, { filename: 'fixtures/moji-adapted/page-api.js' });
  return { api: window.api, window, source };
}

function wait(milliseconds) { return new Promise(resolve => setTimeout(resolve, milliseconds)); }
function code(error) { return error && error.code; }

const cases = [
  ['Moji API shape, arity and unsupported method', async () => {
    const host = createHost();
    const { api, window, source } = load(host);
    assert.equal(api.version(), 'moji-adapted-v1');
    assert.equal(typeof api.getSettings, 'function');
    assert.equal(typeof api.setSettings, 'function');
    assert.equal(typeof api.save, 'function');
    assert.equal(typeof api.saveAs, 'function');
    assert.equal(typeof api.onOpenDocument, 'function');
    assert.equal(typeof api.onCloseRequest, 'function');
    assert.equal(typeof api.onUpdateState, 'function');
    assert.equal(api.getSettings.length, 0);
    assert.equal(api.setSettings.length, 1);
    assert.equal(api.save.length, 2);
    assert.equal(api.getDroppedPath.length, 0);
    assert.equal('__electronMbtIngress' in window, false);
    assert.equal(source.includes('contextBridge'), false);
    assert.equal(source.includes('ipcRenderer'), false);
    await assert.rejects(api.getDroppedPath('file'), error => code(error) === 'ELECTRON_MBT_UNSUPPORTED_API');
    assert.equal(host.calls.length, 0);
  }],
  ['Moji event disposers and duplicate records', async () => {
    const host = createHost();
    const { api } = load(host);
    const seen = [];
    const callback = value => seen.push(value);
    const first = api.onOpenDocument(callback);
    const second = api.onOpenDocument(callback);
    assert.equal(typeof first, 'function');
    assert.notEqual(first, second);
    host.emit('doc:open', { path: 'a' });
    assert.deepEqual(seen, [{ path: 'a' }, { path: 'a' }]);
    first();
    first();
    host.emit('doc:open', { path: 'b' });
    assert.deepEqual(seen, [{ path: 'a' }, { path: 'a' }, { path: 'b' }]);
    second();
    host.emit('doc:open', { path: 'c' });
    assert.equal(seen.length, 3);
    const close = [];
    const disposeClose = api.onCloseRequest(() => close.push('close'));
    host.emit('app:request-close', null);
    disposeClose();
    host.emit('app:request-close', null);
    assert.deepEqual(close, ['close']);
  }],
  ['Moji calls snapshot arguments and dispatch in FIFO order', async () => {
    const host = createHost();
    const { api } = load(host);
    const settings = { theme: 'dark' };
    const save = api.save('doc.md', 'body');
    const set = api.setSettings(settings);
    const get = api.getSettings();
    settings.theme = 'light';
    assert.equal(host.calls.length, 0);
    host.ready();
    const [saveValue, setValue, getValue] = await Promise.all([save, set, get]);
    assert.deepEqual(host.calls, [
      { operation: 'file:save', args: '["doc.md","body"]' },
      { operation: 'settings:set', args: '[{"theme":"dark"}]' },
      { operation: 'settings:get', args: null },
    ]);
    assert.equal(saveValue.operation, 'file:save');
    assert.equal(setValue.operation, 'settings:set');
    assert.equal(getValue.operation, 'settings:get');
  }],
  ['Moji queue call bound rejects the next call', async () => {
    const host = createHost();
    const { api } = load(host);
    const admitted = [];
    for (let index = 0; index < 8; index += 1) admitted.push(api.getSettings());
    const overflow = api.save('doc.md', 'body');
    await assert.rejects(overflow, error => code(error) === 'ELECTRON_MBT_ADAPTER_QUEUE_FULL');
    host.ready();
    await Promise.all(admitted);
    assert.equal(host.calls.length, 8);
  }],
  ['Moji ingress deadline rejects once and ignores late readiness', async () => {
    const host = createHost();
    const { api } = load(host);
    const pending = api.getSettings().then(
      () => assert.fail('queued call unexpectedly resolved'),
      error => error,
    );
    await wait(420);
    assert.equal(code(await pending), 'ELECTRON_MBT_ADAPTER_INGRESS_TIMEOUT');
    host.ready();
    assert.equal(host.calls.length, 0);
    await assert.rejects(api.getSettings(), error => code(error) === 'ELECTRON_MBT_ADAPTER_INGRESS_UNAVAILABLE');
  }],
];

async function run() {
  const results = [];
  for (const [label, testCase] of cases) {
    try {
      await testCase();
      results.push({ label, status: 'PASS' });
    } catch (error) {
      results.push({ label, status: 'FAIL', code: error && error.code, detail: String((error && error.message) || error).slice(0, 200) });
    }
  }
  const failed = results.filter(result => result.status === 'FAIL');
  return {
    status: failed.length === 0 ? 'PASS' : 'FAIL',
    cases: results,
    failed: failed.length,
    appId: 'moji-v1.0.5',
    compatible: false,
    note: 'Generated Moji API shape only; original preload and Moji handlers are not executed.',
  };
}

if (require.main === module) {
  run().then(result => {
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (result.status !== 'PASS') process.exitCode = 1;
  });
}

module.exports = { run };
