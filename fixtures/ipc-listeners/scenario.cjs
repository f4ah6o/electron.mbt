'use strict';
const assert = require('node:assert/strict');

function runScenario(ipcMain) {
  const results = [];
  const channel = 'electron-mbt:listener-fixture';
  const clean = () => ipcMain.removeAllListeners(channel);
  const check = (name, fn) => {
    clean();
    fn();
    clean();
    results.push([name, true]);
  };

  check('aliases and fluent registration', () => {
    const fn = () => {};
    assert.equal(ipcMain.on, ipcMain.addListener);
    assert.equal(ipcMain.off, ipcMain.removeListener);
    assert.equal(ipcMain.on(channel, fn), ipcMain);
    assert.equal(ipcMain.once(channel, fn), ipcMain);
    assert.equal(ipcMain.off(channel, fn), ipcMain);
    assert.equal(ipcMain.removeAllListeners(channel), ipcMain);
    assert.equal(ipcMain.emit(channel), false);
  });
  check('registration order receiver and argument identity', () => {
    const event = {};
    const data = { value: 42 };
    const trace = [];
    for (const name of ['first', 'second']) {
      ipcMain.on(channel, function (receivedEvent, receivedData) {
        assert.equal(this, ipcMain);
        assert.equal(receivedEvent, event);
        assert.equal(receivedData, data);
        trace.push(name);
      });
    }
    assert.equal(ipcMain.emit(channel, event, data), true);
    assert.deepEqual(trace, ['first', 'second']);
  });
  check('duplicate removal selects the most recent registration', () => {
    const trace = [];
    const a = () => trace.push('a');
    const b = () => trace.push('b');
    ipcMain.on(channel, a).on(channel, b).on(channel, a);
    assert.equal(ipcMain.listenerCount(channel, a), 2);
    ipcMain.removeListener(channel, a);
    assert.deepEqual(ipcMain.listeners(channel), [a, b]);
    ipcMain.emit(channel);
    assert.deepEqual(trace, ['a', 'b']);
  });
  check('removal during emission keeps the current snapshot', () => {
    const trace = [];
    const b = () => trace.push('b');
    ipcMain.on(channel, () => { trace.push('a'); ipcMain.off(channel, b); });
    ipcMain.on(channel, b);
    ipcMain.emit(channel);
    ipcMain.emit(channel);
    assert.deepEqual(trace, ['a', 'b', 'a']);
  });
  check('additions during emission start with the next emission', () => {
    const trace = [];
    const b = () => trace.push('b');
    ipcMain.once(channel, () => { trace.push('a'); ipcMain.on(channel, b); });
    ipcMain.emit(channel);
    assert.deepEqual(trace, ['a']);
    ipcMain.emit(channel);
    assert.deepEqual(trace, ['a', 'b']);
  });
  check('nested emission invokes an already snapshotted once callback only once', () => {
    const trace = [];
    let nested = false;
    ipcMain.on(channel, () => {
      trace.push('regular');
      if (!nested) { nested = true; ipcMain.emit(channel); }
    });
    ipcMain.once(channel, () => trace.push('once'));
    ipcMain.emit(channel);
    assert.deepEqual(trace, ['regular', 'regular', 'once']);
    assert.equal(ipcMain.listenerCount(channel), 1);
  });
  check('once is removed before its own callback reenters', () => {
    let count = 0;
    ipcMain.once(channel, () => {
      count++;
      assert.equal(ipcMain.listenerCount(channel), 0);
      assert.equal(ipcMain.emit(channel), false);
    });
    ipcMain.emit(channel);
    assert.equal(count, 1);
  });
  check('removing all during emission preserves captured once callbacks', () => {
    const trace = [];
    ipcMain.on(channel, () => { trace.push('first'); clean(); });
    ipcMain.once(channel, () => trace.push('once'));
    ipcMain.emit(channel);
    assert.deepEqual(trace, ['first', 'once']);
    assert.equal(ipcMain.listenerCount(channel), 0);
  });
  check('throwing before a once callback does not consume it', () => {
    const expected = new Error('listener fixture');
    const throwing = () => { throw expected; };
    let count = 0;
    ipcMain.on(channel, throwing);
    ipcMain.once(channel, () => count++);
    assert.throws(() => ipcMain.emit(channel), error => error === expected);
    ipcMain.off(channel, throwing);
    ipcMain.emit(channel);
    assert.equal(count, 1);
  });
  check('throwing once callbacks remain consumed', () => {
    const expected = new Error('once fixture');
    ipcMain.once(channel, () => { throw expected; });
    assert.throws(() => ipcMain.emit(channel), error => error === expected);
    assert.equal(ipcMain.emit(channel), false);
  });
  check('once callbacks are removable by original or wrapper identity', () => {
    const fn = () => {};
    ipcMain.once(channel, fn);
    const [raw] = ipcMain.rawListeners(channel);
    assert.notEqual(raw, fn);
    assert.equal(raw.listener, fn);
    assert.deepEqual(ipcMain.listeners(channel), [fn]);
    ipcMain.off(channel, raw);
    assert.equal(ipcMain.listenerCount(channel), 0);
    ipcMain.once(channel, fn);
    ipcMain.off(channel, fn);
    assert.equal(ipcMain.listenerCount(channel), 0);
  });
  check('listener snapshots can be mutated without changing registrations', () => {
    const fn = () => {};
    ipcMain.on(channel, fn);
    ipcMain.listeners(channel).pop();
    ipcMain.rawListeners(channel).pop();
    assert.deepEqual(ipcMain.listeners(channel), [fn]);
    assert.equal(ipcMain.removeListener(channel, () => {}), ipcMain);
    assert.equal(ipcMain.listenerCount(channel), 1);
  });
  return results;
}

module.exports = { runScenario };
