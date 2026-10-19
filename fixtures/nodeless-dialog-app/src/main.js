'use strict';
const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

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
  ipcMain.handle('dialog:save-selftest', async function () {
    const result = { ok: true };
    try {
      result.stage = 'shape';
      result.shape = typeof dialog.showSaveDialog === 'function';
      result.syncCode = codeOf(function () { dialog.showSaveDialogSync(); });

      result.stage = 'new-file';
      // 1. A new file: the save selection grants exact-file read+write.
      const created = await dialog.showSaveDialog({
        defaultPath: 'note.md',
        filters: [{ name: 'text', extensions: ['txt', 'md'] }],
        title: 'nodeless-save',
        buttonLabel: 'Save',
      });
      const newPath = created.filePath;
      const newDir = path.dirname(newPath);
      fs.writeFileSync(newPath, 'save-new');
      const firstRead = fs.readFileSync(newPath, 'utf8');
      fs.writeFileSync(newPath, 'save-new-again');
      result.newFile = {
        canceled: created.canceled,
        filePath: newPath,
        firstRead: firstRead,
        read: fs.readFileSync(newPath, 'utf8'),
        bytes: fs.statSync(newPath).size,
        siblingWrite: codeOf(function () { fs.writeFileSync(newPath + '.sibling', 'denied'); }),
      };

      result.stage = 'existing';
      // 2. An existing file is overwritten in place; the grant stays exact.
      const existing = await dialog.showSaveDialog({ defaultPath: newPath });
      const existingPath = existing.filePath;
      fs.writeFileSync(existingPath, 'save-existing');
      result.existing = {
        canceled: existing.canceled,
        filePath: existingPath,
        read: fs.readFileSync(existingPath, 'utf8'),
        siblingRead: codeOf(function () { fs.readFileSync(existingPath + '.sibling', 'utf8'); }),
        siblingWrite: codeOf(function () { fs.writeFileSync(existingPath + '.sibling', 'denied'); }),
        readdir: codeOf(function () { fs.readdirSync(path.dirname(existingPath)); }),
        mkdir: codeOf(function () { fs.mkdirSync(path.dirname(existingPath) + '/denied-dir'); }),
      };

      result.stage = 'cancel';
      // 3. Cancel returns undefined filePath and grants nothing. The test
      // pre-creates the sibling so this is a grant denial, not an ENOENT.
      const canceled = await dialog.showSaveDialog({});
      result.cancel = {
        canceled: canceled.canceled,
        hasFilePath: Object.prototype.hasOwnProperty.call(canceled, 'filePath'),
        undefinedFilePath: canceled.filePath === undefined,
        targetWrite: codeOf(function () { fs.writeFileSync(newPath + '.cancel', 'denied'); }),
      };

      result.stage = 'defaults';
      // 4. defaultPath shapes are display hints only: an existing directory,
      // a bare file name, and an absolute file all stay ungranted until the
      // panel confirms. Invalid and unsupported options never reach the host.
      const dirDefault = await dialog.showSaveDialog({ defaultPath: newDir });
      const bareDefault = await dialog.showSaveDialog({ defaultPath: 'note.md' });
      const fileDefault = await dialog.showSaveDialog({ defaultPath: existingPath });
      const overwriteProperty = await dialog.showSaveDialog({
        properties: ['showOverwriteConfirmation'],
      });
      result.defaults = {
        directoryCanceled: dirDefault.canceled,
        bareCanceled: bareDefault.canceled,
        fileCanceled: fileDefault.canceled,
        overwriteCanceled: overwriteProperty.canceled,
        relativeCode: await promiseCode(dialog.showSaveDialog({ defaultPath: 'dir/file.md' })),
        unknownCode: await promiseCode(dialog.showSaveDialog({ nameFieldLabel: 'x' })),
        propertyCode: await promiseCode(dialog.showSaveDialog({ properties: ['createDirectory'] })),
      };

      result.stage = 'rejections';
      // 5. Typed host rejections for a directory, a missing parent, a dangling
      // symlink and the filesystem root. A duplicate target merges its bits.
      const directory = await promiseCode(dialog.showSaveDialog({}));
      const missingParent = await promiseCode(dialog.showSaveDialog({}));
      const dangling = await promiseCode(dialog.showSaveDialog({}));
      const duplicate = await dialog.showSaveDialog({});
      const root = await promiseCode(dialog.showSaveDialog({}));
      result.rejections = {
        directory: directory,
        missingParent: missingParent,
        dangling: dangling,
        duplicateRead: (function () {
          try {
            return fs.readFileSync(duplicate.filePath, 'utf8');
          } catch (error) {
            return error && error.code ? error.code : 'no-code';
          }
        })(),
        root: root,
      };

      result.stage = 'parent';
      // 6. The parent overload mirrors the open dialog: live parent accepted,
      // destroyed parent rejected before the host.
      const liveParent = await dialog.showSaveDialog(window, { defaultPath: 'note.md' });
      window.destroy();
      result.stage = 'destroyed';
      const destroyed = await promiseCode(dialog.showSaveDialog(window, {}));
      result.parent = { liveCanceled: liveParent.canceled, destroyed: destroyed };
      result.stage = 'recreate';
      await loadWindow();
      result.stage = 'recreated';

      result.stage = 'cap';
      // 7. A save selection that would exceed the 64-file grant registry fails
      // without issuing a partial grant. The normal scenario cancels here.
      result.cap = await promiseCode(dialog.showSaveDialog({}));

      result.stage = 'controls';
      // 8. Test-only controls stay outside the app allowlist.
      result.selfSetResults = hostRequestCode('set-main-save-dialog-results', { results: [] });
      result.selfStatus = hostRequestCode('get-main-save-dialog-status', {});
    } catch (error) {
      result.ok = false;
      result.code = error && error.code ? error.code : String(error);
    }
    return result;
  });
  ipcMain.handle('dialog:save-ui-selftest', async function () {
    try {
      const saved = await dialog.showSaveDialog({ defaultPath: 'nodeless-save-ui.md' });
      return { ok: true, canceled: saved.canceled, filePath: saved.filePath };
    } catch (error) {
      return { ok: false, code: error && error.code ? error.code : 'no-code' };
    }
  });
});
