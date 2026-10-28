'use strict';
const { app, BrowserWindow, ipcMain } = require('electron');
app.whenReady().then(function () {
  ipcMain.handle('app:get-settings', function () {
    return { theme: 'dark' };
  });
  const win = new BrowserWindow({ width: 400, height: 300, title: 'migrate-fixture', show: false });
  win.loadFile('out/renderer/index.html');
});
