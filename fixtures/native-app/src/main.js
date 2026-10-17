'use strict';
const { app } = require('electron');
const direct = require('./lib/greet');
const viaIndex = require('./lib');
const data = require('./lib/data.json');
const scenario = require('./lib/scenario');
const pkg = require('fixture-pkg');
const pkgAgain = require('fixture-pkg');
if (direct !== viaIndex) throw new Error('module cache identity lost');
if (pkg !== pkgAgain) throw new Error('package cache identity lost');
if (data.kind !== 'fixture') throw new Error('JSON module failed');
if (pkg.kind !== 'package' || pkg.title !== 'native-app-window') throw new Error('package exports failed');
globalThis.__nativeMain = app.name;
globalThis.__nativeTitle = pkg.title;
globalThis.__nativeScenario = scenario;
globalThis.__nativeInvoke = function (operation, payloadJson) {
  const payload = payloadJson ? JSON.parse(payloadJson) : {};
  if (operation === 'app:get-settings') {
    return JSON.stringify({
      ok: true,
      result: {
        theme: 'light',
        documentTitle: scenario.label,
        scenarioPath: scenario.entry,
        source: 'quickjs-main',
        app: app.name,
      },
    });
  }
  if (operation === 'app:get-update-state') {
    return JSON.stringify({
      ok: true,
      result: { state: 'ready', source: 'quickjs-main', app: app.name },
    });
  }
  if (operation === 'selftest:unsupported-builtin') {
    try {
      require('node:fs');
      return JSON.stringify({ ok: true, result: { code: 'UNEXPECTED_SUCCESS' } });
    } catch (error) {
      return JSON.stringify({ ok: true, result: { code: String(error.message) } });
    }
  }
  return JSON.stringify({ ok: false, code: 'ELECTRON_MBT_MAIN_UNKNOWN_OPERATION' });
};
module.exports = { name: app.name, title: pkg.title };
