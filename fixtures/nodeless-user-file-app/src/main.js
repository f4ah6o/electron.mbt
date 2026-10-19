'use strict';
const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('node:fs');
const fsp = require('node:fs/promises');

function codeOf(callback) {
  try {
    callback();
    return 'no-error';
  } catch (error) {
    return error && error.code ? error.code : 'no-code';
  }
}

// Call the private bridge directly, as hostile app code could. Control
// operations must be rejected by the native JS allowlist, not by the prelude.
function hostRequestCode(operation, payload) {
  try {
    const raw = globalThis.__mbt_host_request(operation, JSON.stringify(payload));
    if (typeof raw !== 'string') return 'no-response';
    const parsed = JSON.parse(raw);
    return parsed && parsed.payload && parsed.payload.code ? parsed.payload.code : 'no-code';
  } catch (error) {
    return error && error.code ? error.code : 'threw';
  }
}

app.whenReady().then(function () {
  ipcMain.handle('userfile:selftest', async function () {
    const result = { ok: true };
    try {
      const scenario = JSON.parse(fs.readFileSync('nodeless-user-file.json', 'utf8'));

      result.readText = fs.readFileSync(scenario.readPath, 'utf8');
      result.readAsync = await fsp.readFile(scenario.readPath, 'utf8');
      result.existsRead = fs.existsSync(scenario.readPath);

      await fsp.writeFile(scenario.writePath, 'user-write-async', 'utf8');
      result.writeAsync =
        (await fsp.readFile(scenario.writePath, 'utf8')) === 'user-write-async';
      fs.writeFileSync(scenario.writePath, 'user-write');
      result.writeReadBack = fs.readFileSync(scenario.writePath, 'utf8') === 'user-write';
      result.existsWrite = fs.existsSync(scenario.writePath);

      result.deniedRead = codeOf(function () {
        fs.readFileSync(scenario.deniedPath, 'utf8');
      });
      result.deniedExists = fs.existsSync(scenario.deniedPath);
      result.deniedWrite = codeOf(function () {
        fs.writeFileSync(scenario.deniedWritePath, 'denied');
      });

      result.selfGrantBlocked =
        hostRequestCode('grant-main-file',
          { path: scenario.deniedPath, mode: 'read' }) ===
        'ELECTRON_MBT_HOST_REQUEST_DENIED';
      result.controlGrantBlocked =
        hostRequestCode('grant-file', { path: 'scratch.txt', mode: 'read' }) ===
        'ELECTRON_MBT_HOST_REQUEST_DENIED';
    } catch (error) {
      result.ok = false;
      result.error = error && error.code ? error.code : String(error);
    }
    if (result.readText !== '# user read\n' || result.readAsync !== '# user read\n' ||
        result.existsRead !== true || result.writeReadBack !== true ||
        result.writeAsync !== true || result.existsWrite !== true ||
        result.deniedRead !== 'EACCES' || result.deniedExists !== false ||
        result.deniedWrite !== 'EACCES' || result.selfGrantBlocked !== true ||
        result.controlGrantBlocked !== true) {
      result.ok = false;
    }
    return result;
  });
  const window = new BrowserWindow({
    width: 480,
    height: 320,
    title: 'nodeless-user-file',
    show: false,
  });
  window.loadFile('index.html');
});
