'use strict';
const { app, BrowserWindow } = require('electron');
let window = null;
app.whenReady().then(function () {
  window = new BrowserWindow({
    width: 480,
    height: 320,
    title: 'nodeless-window',
    show: false,
  });
  window.once('ready-to-show', function () {
    window.show();
  });
  window.loadFile('index.html');
});
