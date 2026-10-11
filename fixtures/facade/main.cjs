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
// Electron's setPath throws when the target is missing or not a directory.
try { app.setPath('userData', `${process.env.ELECTRON_MBT_TEST_USERDATA}-missing`); push('setPath-missing', 'resolved'); }
catch (error) { push('setPath-missing', error.code); }
try { app.setPath('userData', __filename); push('setPath-file', 'resolved'); }
catch (error) { push('setPath-file', error.code); }
fs.mkdirSync(process.env.ELECTRON_MBT_TEST_USERDATA, { recursive: true });
app.setPath('userData', process.env.ELECTRON_MBT_TEST_USERDATA);
push('setPath-userData', app.getPath('userData') === process.env.ELECTRON_MBT_TEST_USERDATA);
let quitOnce = false;
app.on('before-quit', event => { push('before-quit'); if (!quitOnce) { quitOnce = true; event.preventDefault(); } });
app.on('will-quit', () => push('will-quit'));
app.on('quit', (event, exitCode) => { push('quit-event', typeof event === 'object' && event !== null, exitCode); fs.writeSync(1, `ELECTRON_MBT_FACADE=${JSON.stringify(trace)}\n`); });
app.once('ready', (event, launchInfo) => push('ready-event', typeof event === 'object' && event !== null, launchInfo !== null && typeof launchInfo === 'object'));
app.whenReady().then(launchInfo => {
  push('whenReady-resolved', app.isReady(), launchInfo !== null && typeof launchInfo === 'object');
  app.quit();
  push('alive-after-cancelled-quit', app.isReady());
  app.quit();
});
setTimeout(() => { push('watchdog-timeout'); fs.writeSync(1, `ELECTRON_MBT_FACADE=${JSON.stringify(trace)}\n`); app.exit(3); }, 10000);
