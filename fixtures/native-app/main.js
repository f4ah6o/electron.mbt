'use strict';
const { app } = require('electron');
globalThis.__nativeMain = app.name;
globalThis.__nativeTitle = 'native-app-window';
module.exports = { name: app.name, title: globalThis.__nativeTitle };
