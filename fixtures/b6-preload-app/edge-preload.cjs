'use strict';
const { contextBridge, ipcRenderer } = require('electron');
const callbacks = new Set();
function cycle() {
  const value = {};
  value.self = value;
  return value;
}
function accessor() {
  const value = {};
  Object.defineProperty(value, 'x', { enumerable: true, get() { return 1; } });
  return value;
}
function deep() {
  let value = {};
  let cursor = value;
  for (let index = 0; index < 12; index += 1) {
    cursor.next = {};
    cursor = cursor.next;
  }
  return value;
}
function symbolKey() {
  const value = { visible: 2 };
  value[Symbol('edge')] = 1;
  return value;
}
contextBridge.exposeInMainWorld('edge', {
  data: { nested: { value: 7 }, list: [1, 2, 3] },
  echo: value => value,
  returnUndefined: () => undefined,
  returnFunction: () => () => 9,
  throwTypeError: () => { throw new TypeError('edge-throw'); },
  returnError: () => new RangeError('edge-return'),
  returnDate: () => new Date(0),
  returnMap: () => new Map([['a', 1]]),
  returnSet: () => new Set([1]),
  returnTyped: () => new Uint8Array([1, 2]),
  returnNonFinite: () => Infinity,
  returnBigInt: () => 1n,
  returnSymbol: () => Symbol('edge'),
  returnCycle: () => cycle(),
  returnAccessor: () => accessor(),
  returnSymbolKey: () => symbolKey(),
  returnHole: () => [1, , 3],
  returnOversize: () => 'x'.repeat(40000),
  returnDeep: () => deep(),
  promiseResolve: value => Promise.resolve(value),
  promiseReject: () => Promise.reject(new RangeError('edge-reject')),
  promiseUnsupported: () => Promise.resolve(new Date(0)),
  thenableResolve: value => ({ then(resolve) { resolve(value); } }),
  thenableDouble: value => ({
    then(resolve, reject) { resolve(value); reject(new Error('edge-late')); },
  }),
  add: callback => { callbacks.add(callback); },
  remove: callback => { callbacks.delete(callback); },
  fire: value => { for (const callback of callbacks) callback(value); },
  subscribe: callback => {
    const listener = value => callback(value);
    callbacks.add(listener);
    let active = true;
    return () => {
      if (!active) return false;
      active = false;
      return callbacks.delete(listener);
    };
  },
  call: callback => callback(21),
  nested: callback => callback(),
  callbackFunction: callback => callback(() => 33),
  report: state => ipcRenderer.send('edge:report', state),
});
