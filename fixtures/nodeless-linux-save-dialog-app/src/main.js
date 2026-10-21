'use strict';
const { app, BrowserWindow, dialog } = require('electron');
const fs = require('node:fs');

app.whenReady().then(async function () {
  const result = await dialog.showSaveDialog({ defaultPath: 'saved.md' });
  if (result.canceled || typeof result.filePath !== 'string' || !result.filePath) {
    throw new Error('save dialog did not return a path');
  }
  fs.writeFileSync(result.filePath, 'dialog-saved\n');
  const window = new BrowserWindow({
    width: 480,
    height: 320,
    title: 'nodeless-linux-save-dialog',
  });
  window.loadFile('index.html');
});
