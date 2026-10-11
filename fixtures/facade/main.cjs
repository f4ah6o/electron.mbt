'use strict';
const fs = require('node:fs');
const electron = require('electron');
const { app } = electron;
const trace = [];
const push = (...args) => trace.push(args);
push('module-identity', electron === require('./dependency/index.cjs'));
push('isReady-before', app.isReady());
try { new electron.BrowserWindow({ show: false }); push('browserwindow', 'constructed'); }
catch (error) { push('browserwindow', error.code); }
try { electron.contextBridge.exposeInMainWorld('leak', {}); push('contextbridge', 'exposed'); }
catch (error) { push('contextbridge', error.code); }
try { electron.ipcMain.handle('fixture', () => 1); push('ipcmain-handle', 'registered'); }
catch (error) { push('ipcmain-handle', error.code); }
try { app.getPath('no-such-path'); push('getPath-unknown', 'resolved'); }
catch (error) { push('getPath-unknown', error.code); }
push('getName', app.getName());
push('getVersion', app.getVersion());
push('isPackaged', app.isPackaged());
push('getAppPath', app.getAppPath() === process.env.ELECTRON_MBT_TEST_ROOT);
push('userData', app.getPath('userData') === process.env.ELECTRON_MBT_TEST_USERDATA);
app.setPath('userData', process.env.ELECTRON_MBT_TEST_USERDATA);
let quitOnce = false;
app.on('before-quit', event => { push('before-quit'); if (!quitOnce) { quitOnce = true; event.preventDefault(); } });
app.on('will-quit', () => push('will-quit'));
app.on('quit', () => { push('quit'); fs.writeSync(1, `ELECTRON_MBT_FACADE=${JSON.stringify(trace)}\n`); });
app.whenReady().then(() => {
  push('whenReady-resolved', app.isReady());
  app.quit();
  push('alive-after-cancelled-quit', app.isReady());
  app.quit();
});
setTimeout(() => { push('watchdog-timeout'); fs.writeSync(1, `ELECTRON_MBT_FACADE=${JSON.stringify(trace)}\n`); app.exit(3); }, 10000);
