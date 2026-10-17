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

const settings = {
  theme: 'light',
  documentTitle: scenario.label,
  scenarioPath: scenario.entry,
};
const handlers = Object.create(null);
const register = function (operation, handler) {
  handlers[operation] = handler;
};

register('app:get-settings', function () {
  return {
    theme: settings.theme,
    documentTitle: settings.documentTitle,
    scenarioPath: settings.scenarioPath,
    source: 'quickjs-main',
    app: app.name,
  };
});
register('app:get-update-state', function () {
  return { state: 'ready', source: 'quickjs-main', app: app.name };
});
register('settings:get', function () {
  return { settings: Object.assign({}, settings), source: 'quickjs-main' };
});
register('settings:set', function (payload) {
  const patch = Array.isArray(payload.args) ? payload.args[0] : null;
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    throw new Error('ELECTRON_MBT_MAIN_INVALID_ARGUMENT');
  }
  if (typeof patch.theme === 'string') settings.theme = patch.theme;
  if (typeof patch.documentTitle === 'string') settings.documentTitle = patch.documentTitle;
  return { settings: Object.assign({}, settings), source: 'quickjs-main' };
});
register('update:get-state', function () {
  return { state: 'idle', version: '1.0.5', source: 'quickjs-main' };
});
register('update:check', function () {
  return { checked: true, state: 'idle', source: 'quickjs-main' };
});
register('app:confirm-close', function (payload) {
  const requested = Array.isArray(payload.args) ? payload.args[0] : true;
  return { shouldClose: requested !== false, source: 'quickjs-main' };
});
register('selftest:unsupported-builtin', function () {
  try {
    require('node:fs');
    return { code: 'UNEXPECTED_SUCCESS' };
  } catch (error) {
    return { code: String(error.message) };
  }
});

globalThis.__nativeMain = app.name;
globalThis.__nativeTitle = pkg.title;
globalThis.__nativeScenario = scenario;
globalThis.__nativeInvoke = function (operation, payloadJson) {
  const payload = payloadJson ? JSON.parse(payloadJson) : {};
  const handler = handlers[operation];
  if (!handler) {
    return JSON.stringify({ ok: false, code: 'ELECTRON_MBT_MAIN_UNKNOWN_OPERATION' });
  }
  try {
    return JSON.stringify({ ok: true, result: handler(payload) });
  } catch (error) {
    return JSON.stringify({
      ok: false,
      code: (error && error.code) || 'ELECTRON_MBT_MAIN_ERROR',
    });
  }
};
module.exports = { name: app.name, title: pkg.title };
