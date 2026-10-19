'use strict';
const { app, BrowserWindow, ipcMain } = require('electron');

app.whenReady().then(function () {
  ipcMain.handle('app:get-settings', function () {
    return { theme: 'dark' };
  });
  ipcMain.handle('app:get-update-state', function () {
    return { status: 'idle' };
  });
  const window = new BrowserWindow({
    width: 480,
    height: 320,
    title: 'nodeless-adapted',
    show: false,
  });
  window.loadFile('renderer/index.html');
});
