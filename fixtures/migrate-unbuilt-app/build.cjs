'use strict';
const fs = require('node:fs');
const path = require('node:path');
const root = __dirname;
fs.mkdirSync(path.join(root, 'out/main'), { recursive: true });
fs.mkdirSync(path.join(root, 'out/renderer'), { recursive: true });
fs.writeFileSync(path.join(root, 'out/main/worker.js'),
  "'use strict';\nmodule.exports = { worker: 'ready' };\n");
fs.writeFileSync(path.join(root, 'out/main/index.js'), `'use strict';
const { app, BrowserWindow, ipcMain } = require('electron');
const worker = require('./worker.js');
app.whenReady().then(function () {
  ipcMain.handle('app:get-settings', function () {
    return { theme: 'dark', worker: worker.worker };
  });
  const win = new BrowserWindow({ width: 480, height: 320, title: 'unbuilt-fixture', show: true });
  win.loadFile('out/renderer/index.html');
});
`);
fs.writeFileSync(path.join(root, 'out/renderer/index.html'),
  '<!doctype html><meta charset="utf-8"><title>unbuilt-fixture-ready</title><body><div id="root">built</div><script src="app.js"></script></body>\n');
fs.writeFileSync(path.join(root, 'out/renderer/app.js'),
  "'use strict';\nconst root = document.getElementById('root');\nif (root) root.textContent = 'unbuilt fixture ready';\n");
