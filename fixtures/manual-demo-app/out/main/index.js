'use strict';
const { app, BrowserWindow, ipcMain } = require('electron');

app.whenReady().then(function () {
  ipcMain.handle('app:get-settings', function () {
    return {
      theme: 'dark',
      source: 'native main',
      at: new Date().toISOString(),
    };
  });
  ipcMain.handle('demo:ping', function () {
    return { pong: true, at: Date.now() };
  });
  const win = new BrowserWindow({
    width: 900,
    height: 640,
    title: 'Electromoon manual demo',
    show: true,
  });
  win.loadFile('out/renderer/index.html');
});
