'use strict';
const { app, ipcMain } = require('electron');
const path = require('node:path');
const { Buffer } = require('node:buffer');
const { EventEmitter } = require('node:events');
const a = require('./lib/a');
const b = require('./lib/b');
const data = require('./lib/data.json');
const pkg = require('fixture-pkg');
const pkgAgain = require('fixture-pkg');
if (pkg !== pkgAgain) throw new Error('package cache identity lost');
if (data.kind !== 'fixture') throw new Error('JSON module failed');
if (a !== require('./lib/a')) throw new Error('module cache identity lost');
const emitter = new EventEmitter();
let eventCount = 0;
emitter.on('x', function () { eventCount += 1; });
app.whenReady().then(function () {
  ipcMain.handle('selftest:report', function () {
    emitter.emit('x');
    return {
      app: app.name,
      version: app.getVersion(),
      a: a.name,
      b: b.name,
      cycleA: a.seen,
      cycleB: b.seen,
      pkg: pkg.kind,
      data: data.kind,
      joined: path.join('src', 'lib', 'a.js'),
      b64: Buffer.from('hi').toString('base64'),
      event: eventCount,
      nextTick: typeof process.nextTick === 'function',
      fixtureEnv: process.env.NODELESS_FIXTURE_ENV || null,
      secretEnv: process.env.SECRET_TOKEN || null,
    };
  });
  ipcMain.handle('selftest:async', function () {
    return new Promise(function (resolve) {
      setTimeout(function () { resolve({ value: 9 }); }, 1);
    });
  });
  ipcMain.handle('selftest:order', function () {
    const order = [];
    process.nextTick(function () { order.push('tick'); });
    Promise.resolve().then(function () { order.push('promise'); });
    return new Promise(function (resolve) {
      setTimeout(function () {
        order.push('timer');
        resolve({ order: order });
      }, 2);
    });
  });
  ipcMain.handle('selftest:unsupported', function () {
    const fs = require('node:fs');
    function codeOf(callback) {
      try {
        callback();
        return 'unexpected';
      } catch (error) {
        return error.code;
      }
    }
    return {
      code: codeOf(function () { fs.readFileSync('/missing'); }),
      stat: codeOf(function () { fs.statSync('/missing'); }),
      readdir: codeOf(function () { fs.readdirSync('/missing'); }),
      mkdir: codeOf(function () { fs.mkdirSync('/missing'); }),
    };
  });
});
