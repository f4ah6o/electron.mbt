'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const adapterPath = path.join(root, 'fixtures/native-app/adapted/page-api.js');

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
  vm.runInContext(source, context, { filename: 'fixtures/native-app/adapted/page-api.js' });
  return { api: window.api, window };
}

function wait(milliseconds) { return new Promise(resolve => setTimeout(resolve, milliseconds)); }
function code(error) { return error && error.code; }

const cases = [
  ['version, freeze and install deletion', async () => {
    const host = createHost();
    const { api, window } = load(host);
    assert.equal(api.version(), 'adapted-fixture');
    assert.equal(Object.isFrozen(api), true);
    assert.equal('__electronMbtIngress' in window, false);
    const descriptor = Object.getOwnPropertyDescriptor(window, 'api');
    assert.equal(descriptor.writable, false);
    assert.equal(descriptor.configurable, false);
    assert.equal(descriptor.enumerable, true);
  }],
  ['synchronous disposer and duplicate callback records', async () => {
    const host = createHost();
    const { api } = load(host);
    const seen = [];
    const callback = () => seen.push('a');
    const first = api.onOpenDocument(callback);
    const second = api.onOpenDocument(callback);
    assert.equal(typeof first, 'function');
    assert.equal(typeof second, 'function');
    assert.notEqual(first, second);
    host.emit('doc:open', null);
    assert.deepEqual(seen, ['a', 'a']);
    first();
    first();
    host.emit('doc:open', null);
    assert.deepEqual(seen, ['a', 'a', 'a']);
    second();
    host.emit('doc:open', null);
    assert.deepEqual(seen, ['a', 'a', 'a']);
  }],
  ['emission snapshot and next-emission disposal', async () => {
    const host = createHost();
    const { api } = load(host);
    const order = [];
    let late = null;
    let disposeSecond = null;
    const first = () => {
      order.push('a');
      if (late === null) {
        late = api.onOpenDocument(() => order.push('c'));
        disposeSecond();
      }
    };
    const second = () => order.push('b');
    api.onOpenDocument(first);
    disposeSecond = api.onOpenDocument(second);
    host.emit('doc:open', null);
    // The snapshot taken at emission start still calls the listener that the
    // first callback disposed; the listener added during emission waits.
    assert.deepEqual(order, ['a', 'b']);
    order.length = 0;
    host.emit('doc:open', null);
    assert.deepEqual(order, ['a', 'c']);
  }],
  ['nested emission keeps snapshot order', async () => {
    const host = createHost();
    const { api } = load(host);
    const order = [];
    let depth = 0;
    api.onOpenDocument(() => {
      order.push(`a${depth}`);
      if (depth === 0) {
        depth = 1;
        host.emit('doc:open', null);
        depth = 0;
      }
      order.push('a-end');
    });
    api.onOpenDocument(() => order.push(`b${depth}`));
    host.emit('doc:open', null);
    assert.deepEqual(order, ['a0', 'a1', 'a-end', 'b1', 'a-end', 'b0']);
  }],
  ['listener throw propagates and stops the current emission', async () => {
    const host = createHost();
    const { api } = load(host);
    const seen = [];
    api.onOpenDocument(() => { throw new Error('listener failed'); });
    api.onOpenDocument(() => seen.push('b'));
    assert.throws(() => host.emit('doc:open', null), /listener failed/);
    assert.deepEqual(seen, []);
  }],
  ['invalid listener and unknown topic fail closed', async () => {
    const host = createHost();
    const { api } = load(host);
    assert.throws(() => api.onOpenDocument(null), /listener/);
    assert.throws(() => host.emit('unknown:topic', null), error => code(error) === 'ELECTRON_MBT_ADAPTER_TOPIC');
  }],
  ['queued calls keep call-time arguments and FIFO order', async () => {
    const host = createHost();
    const { api } = load(host);
    const options = { theme: 'light' };
    const first = api.getUpdateState(options);
    const second = api.getSettings();
    options.theme = 'dark';
    assert.equal(host.calls.length, 0);
    host.ready();
    const [firstValue, secondValue] = await Promise.all([first, second]);
    assert.deepEqual(host.calls, [
      { operation: 'app:get-update-state', args: '{"theme":"light"}' },
      { operation: 'app:get-settings', args: null },
    ]);
    assert.deepEqual(firstValue, { operation: 'app:get-update-state', args: '{"theme":"light"}' });
    assert.equal(secondValue.operation, 'app:get-settings');
  }],
  ['call-count bound rejects the next call without dispatch', async () => {
    const host = createHost();
    const { api } = load(host);
    const admitted = [api.getSettings(), api.getSettings(), api.getSettings(), api.getSettings()];
    const overflow = api.getSettings();
    await assert.rejects(overflow, error => code(error) === 'ELECTRON_MBT_ADAPTER_QUEUE_FULL');
    host.ready();
    await Promise.all(admitted);
    assert.equal(host.calls.length, 4);
  }],
  ['byte bound rejects the next call without dispatch', async () => {
    const host = createHost();
    const { api } = load(host);
    const admitted = api.getUpdateState({ blob: 'x'.repeat(9000) });
    const overflow = api.getUpdateState({ blob: 'y'.repeat(9000) });
    await assert.rejects(overflow, error => code(error) === 'ELECTRON_MBT_ADAPTER_QUEUE_FULL');
    host.ready();
    await admitted;
    assert.equal(host.calls.length, 1);
  }],
  ['ready timeout rejects once and ignores late readiness', async () => {
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
  ['ready dispatches immediately and settles once', async () => {
    const host = createHost();
    const { api } = load(host);
    host.ready();
    let settle = null;
    host.dispatch = () => ({
      then(onFulfilled, onRejected) {
        settle = { onFulfilled, onRejected };
      },
    });
    const pending = api.getSettings();
    settle.onFulfilled('first');
    settle.onFulfilled('second');
    settle.onRejected(new Error('late rejection'));
    assert.equal(await pending, 'first');
  }],
  ['non-JSON arguments reject without enqueueing', async () => {
    const host = createHost();
    const { api } = load(host);
    const cyclic = {};
    cyclic.self = cyclic;
    await assert.rejects(api.getUpdateState(undefined), error => code(error) === 'ELECTRON_MBT_ADAPTER_VALUE');
    await assert.rejects(api.getUpdateState(cyclic), error => code(error) === 'ELECTRON_MBT_ADAPTER_VALUE');
    host.ready();
    assert.equal(host.calls.length, 0);
  }],
  ['a fresh document realm has an empty listener table', async () => {
    const firstHost = createHost();
    const first = load(firstHost);
    let called = 0;
    first.api.onOpenDocument(() => { called += 1; });
    firstHost.emit('doc:open', null);
    assert.equal(called, 1);
    const secondHost = createHost();
    const second = load(secondHost);
    assert.notEqual(first.api, second.api);
    secondHost.emit('doc:open', null);
    assert.equal(called, 1);
  }],
];

async function run() {
  const results = [];
  for (const [label, testCase] of cases) {
    try {
      await testCase();
      results.push({ label, status: 'PASS' });
    } catch (error) {
      results.push({
        label,
        status: 'FAIL',
        code: error && error.code,
        detail: String((error && error.message) || error).slice(0, 200),
      });
    }
  }
  const failed = results.filter(result => result.status === 'FAIL');
  return {
    status: failed.length === 0 ? 'PASS' : 'FAIL',
    cases: results,
    failed: failed.length,
    compatible: false,
    note: 'Page-local adapter contract only; native ingress, IPC and app boot are absent.',
  };
}

if (require.main === module) {
  run().then(result => {
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (result.status !== 'PASS') process.exitCode = 1;
  });
}

module.exports = { run };
