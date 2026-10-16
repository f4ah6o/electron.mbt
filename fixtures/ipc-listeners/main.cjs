'use strict';
const fs = require('node:fs');
const electron = require('electron');
if (process.env.ELECTRON_MBT_ORACLE_DATA) electron.app.setPath('userData', process.env.ELECTRON_MBT_ORACLE_DATA);
const { runScenario } = require('./scenario.cjs');
const trace = runScenario(electron.ipcMain);
const observed = {
  status: 'completed',
  moduleIdentity: electron === require('electron'),
  trace,
  observation: { scope: 'main-local-listener-contract', rendererIPC: false },
  versions: { electron: process.versions.electron, node: process.versions.node },
  platform: process.platform,
  arch: process.arch,
};
fs.writeSync(1, `ELECTRON_MBT_IPC_LISTENERS=${JSON.stringify(observed)}\n`);
electron.app.whenReady().then(() => electron.app.exit(0));
