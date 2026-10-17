'use strict';
const { current } = require('./runtime-session.cjs');
const { runtimeError } = require('./errors.cjs');

const runtime = current();
const implemented = Object.freeze({
  app: runtime.app,
  BrowserWindow: runtime.BrowserWindow,
});
module.exports = new Proxy(implemented, {
  get(target, property, receiver) {
    if (typeof property === 'symbol') return Reflect.get(target, property, receiver);
    if (Object.hasOwn(target, property)) return Reflect.get(target, property, receiver);
    throw runtimeError('ELECTRON_MBT_UNSUPPORTED_API',
      'Electron API ' + String(property) + ' is not available in the experimental M1 profile');
  },
});
