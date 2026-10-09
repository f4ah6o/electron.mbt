'use strict';
const fs = require('node:fs');
const path = require('node:path');
const electron = require('electron');
const { app, BrowserWindow, ipcMain } = electron;
const trace = [];
let observation, window, loaded = false, finishing = false;
const moduleIdentity = electron === require('./dependency/index.cjs');
if (process.env.ELECTRON_MBT_ORACLE_DATA) app.setPath('userData', process.env.ELECTRON_MBT_ORACLE_DATA);
const emit = (status, extra = {}) => fs.writeSync(1, `ELECTRON_MBT_ORACLE=${JSON.stringify({ status, moduleIdentity, trace, observation, versions: { electron: process.versions.electron, node: process.versions.node, chromium: process.versions.chrome }, platform: process.platform, arch: process.arch, ...extra })}\n`);
const fail = code => { if (finishing) return; finishing = true; emit('failed', { code }); app.exit(1); };
const watchdog = setTimeout(() => fail('fixture-watchdog'), 15000);
trace.push(['isReady-before', app.isReady()]);
try { new BrowserWindow({ show: false }); trace.push(['before-ready-throws', false]); }
catch (_) { trace.push(['before-ready-throws', true]); }
function complete() {
  if (!loaded || !observation || finishing) return;
  finishing = true;
  clearTimeout(watchdog);
  window.once('close', event => { trace.push(['close-cancel']); event.preventDefault(); });
  window.close();
  trace.push(['alive-after-cancel', !window.isDestroyed()]);
  window.on('closed', () => trace.push(['closed']));
  window.destroy();
  trace.push(['destroyed-synchronously', window.isDestroyed()]);
  app.quit();
}
ipcMain.on('fixture:report', (event, value) => {
  if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) return fail('unexpected-sender');
  if (observation) return fail('duplicate-report');
  observation = value;
  if (observation.fixtureError) return fail('renderer-fixture-error');
  complete();
});
app.on('before-quit', () => trace.push(['before-quit']));
app.on('will-quit', () => trace.push(['will-quit']));
app.on('quit', () => { trace.push(['quit']); emit('completed'); });
app.whenReady().then(() => {
  trace.push(['ready', app.isReady()]);
  window = new BrowserWindow({ width: 640, height: 480, show: false, webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true } });
  const bounds = window.getBounds();
  trace.push(['bounds-synchronous', typeof bounds.width === 'number' && typeof bounds.height === 'number' && !(bounds instanceof Promise)]);
  window.webContents.on('did-finish-load', () => { trace.push(['did-finish-load']); loaded = true; complete(); });
  window.webContents.on('did-fail-load', () => fail('load-failed'));
  window.on('ready-to-show', () => trace.push(['ready-to-show']));
  window.loadFile(path.join(__dirname, 'index.html')).catch(() => fail('load-rejected'));
}).catch(() => fail('ready-rejected'));
