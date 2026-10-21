'use strict';
const { app, BrowserWindow, dialog } = require('electron');
const fs = require('node:fs');

app.whenReady().then(async function () {
  const result = await dialog.showOpenDialog({ properties: ['openFile'] });
  if (result.canceled || !Array.isArray(result.filePaths) || result.filePaths.length !== 1) {
    throw new Error('dialog did not return exactly one file');
  }
  if (fs.readFileSync(result.filePaths[0], 'utf8') !== 'dialog-selected\n') {
    throw new Error('dialog selection was not readable through the grant');
  }
  fs.writeFileSync(result.filePaths[0], 'dialog-updated\n');
  const window = new BrowserWindow({
    width: 480,
    height: 320,
    title: 'nodeless-linux-dialog',
  });
  window.loadFile('index.html');
});
