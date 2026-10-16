'use strict';
const fs = require('node:fs');
const path = require('node:path');
const electron = require('electron');
const { runScenario } = require('./scenario.cjs');
const { app, BrowserWindow, ipcMain } = electron;
if (process.env.ELECTRON_MBT_ORACLE_DATA) app.setPath('userData', process.env.ELECTRON_MBT_ORACLE_DATA);
const watchdog = setTimeout(() => { console.error('handler reference fixture timed out'); app.exit(1); }, 30000);
let window;
app.whenReady().then(async () => {
  window = new BrowserWindow({ show: false, webPreferences: {
    preload: path.join(__dirname, 'preload.cjs'),
    nodeIntegration: false, sandbox: true, contextIsolation: true, webSecurity: true,
  } });
  await window.loadFile(path.join(__dirname, 'index.html'));
  const trace = await runScenario(ipcMain, (channel, args) => window.webContents.executeJavaScript(
    `window.invokeHandlerFixture(${JSON.stringify(channel)}, ${JSON.stringify(args)})`,
  ));
  const observed = {
    status: 'completed', moduleIdentity: electron === require('electron'), trace,
    observation: { profile: 'invoke-handler-tiny-json-v1', scenarios: trace.length },
    versions: { electron: process.versions.electron, node: process.versions.node },
    platform: process.platform, arch: process.arch,
  };
  fs.writeSync(1, `ELECTRON_MBT_INVOKE=${JSON.stringify(observed)}\n`);
  clearTimeout(watchdog);
  window.destroy();
  app.exit(0);
}).catch(error => {
  console.error(error);
  clearTimeout(watchdog);
  if (window && !window.isDestroyed()) window.destroy();
  app.exit(1);
});
