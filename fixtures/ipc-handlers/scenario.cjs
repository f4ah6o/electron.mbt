'use strict';
const assert = require('node:assert/strict');
const channel = 'electron-mbt:invoke-contract';

async function runScenario(ipcMain, invoke) {
  const trace = [];
  const clean = () => { ipcMain.removeHandler(channel); ipcMain.removeAllListeners(channel); };
  async function check(name, run) {
    clean();
    await run();
    clean();
    trace.push([name, true]);
  }
  const call = (...args) => invoke(channel, args);
  const missing = () => assert.rejects(call(), /UnknownHandler|No handler registered/);

  await check('registration and removal return undefined', async () => {
    assert.equal(ipcMain.removeHandler(channel), undefined);
    assert.equal(ipcMain.handle(channel, () => 1), undefined);
    assert.equal(ipcMain.removeHandler(channel), undefined);
    assert.equal(ipcMain.handleOnce(channel, () => 2), undefined);
    assert.equal(await call(), 2);
  });
  await check('duplicate registration preserves the first handler', async () => {
    ipcMain.handle(channel, () => 1);
    assert.throws(() => ipcMain.handle(channel, () => 2), /second handler/);
    assert.throws(() => ipcMain.handleOnce(channel, () => 3), /second handler/);
    assert.equal(await call(), 1);
  });
  await check('handle rejects non-callables without retaining a registration', async () => {
    for (const value of [null, undefined, 1, {}, 'handler']) {
      assert.throws(() => ipcMain.handle(channel, value), TypeError);
    }
    ipcMain.handle(channel, () => 3);
    assert.equal(await call(), 3);
  });
  await check('sync results preserve multiple arguments and unbound receiver', async () => {
    ipcMain.handle(channel, function (_event, left, right) {
      assert.equal(this, undefined);
      return { sum: left + right, values: [left, right] };
    });
    assert.deepEqual(await call(4, 7), { sum: 11, values: [4, 7] });
  });
  await check('promise and thenable results are awaited', async () => {
    ipcMain.handle(channel, () => Promise.resolve(42));
    assert.equal(await call(), 42);
    ipcMain.removeHandler(channel);
    ipcMain.handle(channel, () => ({ then(resolve) { resolve(43); } }));
    assert.equal(await call(), 43);
  });
  await check('sync throws and promise rejections reject the caller', async () => {
    ipcMain.handle(channel, () => { throw new Error('contract-throw'); });
    await assert.rejects(call(), /contract-throw/);
    ipcMain.removeHandler(channel);
    ipcMain.handle(channel, () => Promise.reject(new Error('contract-reject')));
    await assert.rejects(call(), /contract-reject/);
  });
  await check('once handlers are consumed after their first invocation', async () => {
    let calls = 0;
    ipcMain.handleOnce(channel, () => ++calls);
    assert.equal(await call(), 1);
    await missing();
    assert.equal(calls, 1);
  });
  await check('a throwing once handler remains consumed', async () => {
    ipcMain.handleOnce(channel, () => { throw new Error('once-failure'); });
    await assert.rejects(call(), /once-failure/);
    await missing();
  });
  await check('once removal precedes callback registration on the same channel', async () => {
    ipcMain.handleOnce(channel, () => {
      ipcMain.handle(channel, () => 2);
      return 1;
    });
    assert.equal(await call(), 1);
    assert.equal(await call(), 2);
  });
  await check('removing an inflight handler does not retarget its result', async () => {
    const started = Promise.withResolvers();
    const release = Promise.withResolvers();
    ipcMain.handle(channel, () => { started.resolve(); return release.promise; });
    const old = call();
    await started.promise;
    ipcMain.removeHandler(channel);
    ipcMain.handle(channel, () => 22);
    release.resolve(11);
    assert.equal(await old, 11);
    assert.equal(await call(), 22);
  });
  await check('event listeners and invoke handlers are independent', async () => {
    let events = 0;
    ipcMain.on(channel, () => events++);
    ipcMain.handle(channel, () => 10);
    assert.equal(await call(), 10);
    assert.equal(events, 0);
    assert.equal(ipcMain.emit(channel), true);
    assert.equal(events, 1);
    ipcMain.removeAllListeners(channel);
    assert.equal(await call(), 10);
  });
  await check('handler changes do not mutate caller arguments', async () => {
    ipcMain.handle(channel, (_event, value) => { value.count++; return value; });
    const value = { count: 1 };
    assert.deepEqual(await call(value), { count: 2 });
    assert.deepEqual(value, { count: 1 });
  });
  await check('removed handlers reject later calls and allow replacement', async () => {
    ipcMain.handle(channel, () => 1);
    ipcMain.removeHandler(channel);
    await missing();
    ipcMain.handle(channel, () => 2);
    assert.equal(await call(), 2);
  });
  await check('an undefined return value is distinct from null', async () => {
    ipcMain.handle(channel, () => undefined);
    assert.equal(await call(), undefined);
    ipcMain.removeHandler(channel);
    ipcMain.handleOnce(channel, () => null);
    assert.equal(await call(), null);
  });
  await check('argument arrays and records preserve undefined slots', async () => {
    ipcMain.handle(channel, (_event, array, record) => {
      assert.equal(array.length, 2);
      assert.equal(array[0], undefined);
      assert.equal(array[1], null);
      assert.equal(Object.hasOwn(array, '0'), true);
      assert.equal(Object.hasOwn(record, 'missing'), true);
      assert.equal(record.missing, undefined);
      assert.equal(record.explicit, null);
      return true;
    });
    assert.equal(await call([undefined, null], { missing: undefined, explicit: null }), true);
  });
  await check('result arrays and records preserve undefined slots', async () => {
    ipcMain.handle(channel, () => [undefined, { missing: undefined, explicit: null }]);
    assert.deepEqual(await call(), [undefined, { missing: undefined, explicit: null }]);
  });
  return trace;
}

module.exports = { channel, runScenario };
