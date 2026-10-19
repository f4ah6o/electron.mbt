'use strict';
const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const fs = require('node:fs');

function codeOf(callback) {
  try {
    callback();
    return 'no-error';
  } catch (error) {
    return error && error.code ? error.code : 'no-code';
  }
}

async function promiseCode(promise) {
  try {
    await promise;
    return 'no-error';
  } catch (error) {
    return error && error.code ? error.code : 'no-code';
  }
}

// Call the private bridge directly, as hostile app code could. The native JS
// allowlist, not the prelude, must reject test-only controls.
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

let window = null;

function loadWindow() {
  window = new BrowserWindow({
    width: 480,
    height: 320,
    title: 'nodeless-dialog',
    show: false,
  });
  return window.loadFile('index.html');
}

app.whenReady().then(function () {
  loadWindow();
  ipcMain.handle('dialog:selftest', async function () {
    const result = { ok: true };
    try {
      result.stage = 'multi';
      // 1. parentless multi-file selection.
      const multi = await dialog.showOpenDialog({
        properties: ['openFile', 'multiSelections'],
        filters: [{ name: 'text', extensions: ['txt', 'md'] }],
        title: 'nodeless-dialog',
        buttonLabel: 'Open',
      });
      result.multi = {
        canceled: multi.canceled,
        filePaths: multi.filePaths,
        read: multi.filePaths.map(function (path) { return fs.readFileSync(path, 'utf8'); }),
        write: codeOf(function () { fs.writeFileSync(multi.filePaths[0], 'denied'); }),
        siblingRead: codeOf(function () {
          fs.readFileSync(multi.filePaths[0] + '.sibling', 'utf8');
        }),
      };

      result.stage = 'parent';
      // 2. parent overload with a directory selection.
      const parent = await dialog.showOpenDialog(window, {
        properties: ['openDirectory'],
        defaultPath: '/',
      });
      const parentPath = parent.filePaths[0];
      result.parent = {
        canceled: parent.canceled,
        filePaths: parent.filePaths,
        names: fs.readdirSync(parentPath),
        statDir: fs.statSync(parentPath).isDirectory() === true,
        write: codeOf(function () { fs.writeFileSync(parentPath + '/denied.txt', 'denied'); }),
        mkdir: codeOf(function () { fs.mkdirSync(parentPath + '/denied-dir'); }),
      };

      result.stage = 'mixed';
      // 3. mixed file and directory selection.
      const mixed = await dialog.showOpenDialog({
        properties: ['openFile', 'openDirectory', 'multiSelections'],
      });
      result.mixed = { canceled: mixed.canceled, filePaths: mixed.filePaths, entries: [] };
      for (let i = 0; i < mixed.filePaths.length; i++) {
        const path = mixed.filePaths[i];
        if (fs.statSync(path).isDirectory()) {
          result.mixed.entries.push({ kind: 'directory', names: fs.readdirSync(path) });
        } else {
          result.mixed.entries.push({ kind: 'file', text: fs.readFileSync(path, 'utf8') });
        }
      }

      result.stage = 'cancel';
      // 4. cancel.
      const canceled = await dialog.showOpenDialog({ properties: ['openFile'] });
      result.cancel = { canceled: canceled.canceled, filePaths: canceled.filePaths };

      result.stage = 'type-mismatch';
      // 5. directory result requested as a file.
      result.typeMismatch = await promiseCode(
        dialog.showOpenDialog({ properties: ['openFile'] }));
      result.stage = 'multi-not-allowed';
      // 6. multiple paths without multiSelections.
      result.multiNotAllowed = await promiseCode(
        dialog.showOpenDialog({ properties: ['openFile'] }));
      result.stage = 'too-many';
      // 7. per-call selection cap.
      result.tooMany = await promiseCode(
        dialog.showOpenDialog({ properties: ['openFile', 'multiSelections'] }));
      result.stage = 'duplicate';
      // 8. duplicate canonical path.
      result.duplicate = await promiseCode(
        dialog.showOpenDialog({ properties: ['openFile', 'multiSelections'] }));
      result.stage = 'sixteen';
      // 9. exact 16-selection boundary.
      const sixteen = await dialog.showOpenDialog({
        properties: ['openFile', 'multiSelections'],
      });
      result.sixteen = {
        canceled: sixteen.canceled,
        count: sixteen.filePaths.length,
        first: sixteen.filePaths[0],
        last: sixteen.filePaths[sixteen.filePaths.length - 1],
      };

      result.stage = 'unsupported';
      // 10. unsupported option is rejected by the prelude before the host.
      result.unsupported = await promiseCode(
        dialog.showOpenDialog({ securityScopedBookmarks: true }));
      // 11. a destroyed parent is rejected before the host.
      result.stage = 'destroy';
      window.destroy();
      result.stage = 'destroyed';
      result.destroyedParent = await promiseCode(
        dialog.showOpenDialog(window, { properties: ['openFile'] }));
      // Restore a loaded window for the CLI title probe.
      result.stage = 'recreate';
      await loadWindow();
      result.stage = 'recreated';

      result.stage = 'controls';
      // 12. test-only controls stay outside the app allowlist.
      result.selfSetResults = hostRequestCode('set-main-dialog-results', { results: [] });
      result.selfStatus = hostRequestCode('get-main-dialog-status', {});
    } catch (error) {
      result.ok = false;
      result.code = error && error.code ? error.code : String(error);
    }
    return result;
  });
  ipcMain.handle('dialog:ui-selftest', async function () {
    try {
      const opened = await dialog.showOpenDialog({ properties: ['openFile'] });
      return { ok: true, canceled: opened.canceled, filePaths: opened.filePaths };
    } catch (error) {
      return { ok: false, code: error && error.code ? error.code : 'no-code' };
    }
  });
});
