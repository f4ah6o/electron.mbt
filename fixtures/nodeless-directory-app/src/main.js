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

function grantFor(grants, mode) {
  for (let i = 0; i < grants.length; i++) {
    if (grants[i].mode === mode) return grants[i].path;
  }
  return '';
}

// Call the private bridge directly, as hostile app code could. Grant minting
// must be rejected by the native JS allowlist, not by the prelude.
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
  ipcMain.handle('directory:selftest', async function () {
    const result = { ok: true };
    try {
      const scenario = JSON.parse(fs.readFileSync('nodeless-directory.json', 'utf8'));
      const grants = scenario.grants || [];
      const readGrant = grantFor(grants, 'read');
      const writeGrant = grantFor(grants, 'readwrite');
      const writeOnlyGrant = grantFor(grants, 'write');
      result.grantCount = grants.length;
      result.readGrant = readGrant;
      result.writeGrant = writeGrant;
      result.writeOnlyGrant = writeOnlyGrant;

      result.readList = fs.readdirSync(readGrant).indexOf('read.txt') >= 0;
      result.readStatDir = fs.statSync(readGrant).isDirectory() === true;
      result.readStatFile = fs.statSync(readGrant + '/read.txt').isFile() === true;
      result.readText = fs.readFileSync(readGrant + '/read.txt', 'utf8');
      result.readExists = fs.existsSync(readGrant + '/read.txt');
      result.readAsync = (await fsp.readdir(readGrant)).indexOf('read.txt') >= 0;
      const readDirents = fs.readdirSync(readGrant, { withFileTypes: true });
      let readDirent = null;
      for (let i = 0; i < readDirents.length; i++) {
        if (readDirents[i].name === 'read.txt') readDirent = readDirents[i];
      }
      result.readDirent = readDirent !== null && readDirent.isFile() === true &&
        readDirent.isDirectory() === false;
      result.readSymlinkList = codeOf(function () {
        fs.readdirSync(readGrant + '/escape');
      });
      result.readSymlinkStat = codeOf(function () {
        fs.statSync(readGrant + '/escape/secret.txt');
      });
      result.readSymlinkRead = codeOf(function () {
        fs.readFileSync(readGrant + '/escape/secret.txt', 'utf8');
      });
      result.readWriteDenied = codeOf(function () {
        fs.writeFileSync(readGrant + '/new.txt', 'denied');
      });
      result.readMkdirDenied = codeOf(function () {
        fs.mkdirSync(readGrant + '/new-dir');
      });
      result.readTraversal = codeOf(function () {
        fs.readdirSync(readGrant + '/../denied');
      });

      result.writeList = Array.isArray(fs.readdirSync(writeGrant));
      const firstCreated = fs.mkdirSync(writeGrant + '/created', { recursive: true });
      result.writeMkdirFirstCreated = typeof firstCreated === 'string' &&
        firstCreated.slice(firstCreated.length - 8) === '/created';
      fs.writeFileSync(writeGrant + '/created/write.txt', 'directory-write');
      result.writeReadBack =
        fs.readFileSync(writeGrant + '/created/write.txt', 'utf8') === 'directory-write';
      result.writeStatDir = fs.statSync(writeGrant + '/created').isDirectory() === true;
      await fsp.writeFile(writeGrant + '/created/async.txt', 'async-write');
      result.writeAsync =
        (await fsp.readFile(writeGrant + '/created/async.txt', 'utf8')) === 'async-write';
      await fsp.mkdir(writeGrant + '/async-dir', { recursive: true });
      result.writeAsyncMkdir = fs.statSync(writeGrant + '/async-dir').isDirectory() === true;
      result.writeEscapeWrite = codeOf(function () {
        fs.writeFileSync(writeGrant + '/escape/new.txt', 'denied');
      });
      result.writeEscapeMkdir = codeOf(function () {
        fs.mkdirSync(writeGrant + '/escape/new-dir');
      });
      result.writeSymlinkList = codeOf(function () {
        fs.readdirSync(writeGrant + '/escape');
      });
      result.writeMissingParent = codeOf(function () {
        fs.writeFileSync(writeGrant + '/missing/child.txt', 'denied');
      });

      result.writeOnlyList = codeOf(function () {
        fs.readdirSync(writeOnlyGrant);
      });
      result.writeOnlyStat = codeOf(function () {
        fs.statSync(writeOnlyGrant);
      });
      result.writeOnlyRead = codeOf(function () {
        fs.readFileSync(writeOnlyGrant + '/none.txt', 'utf8');
      });
      result.writeOnlyWrite = codeOf(function () {
        fs.writeFileSync(writeOnlyGrant + '/write-only.txt', 'write-only');
      });
      result.writeOnlyReadBack = codeOf(function () {
        fs.readFileSync(writeOnlyGrant + '/write-only.txt', 'utf8');
      });
      const firstWriteOnlyDir =
        fs.mkdirSync(writeOnlyGrant + '/dir', { recursive: true });
      const secondWriteOnlyDir =
        fs.mkdirSync(writeOnlyGrant + '/dir', { recursive: true });
      result.writeOnlyMkdir = typeof firstWriteOnlyDir === 'string' &&
        secondWriteOnlyDir === undefined;

      result.deniedList = codeOf(function () {
        fs.readdirSync(scenario.deniedDir);
      });
      result.deniedStat = codeOf(function () {
        fs.statSync(scenario.deniedDir);
      });
      result.deniedRead = codeOf(function () {
        fs.readFileSync(scenario.deniedFile, 'utf8');
      });
      result.deniedWrite = codeOf(function () {
        fs.writeFileSync(scenario.deniedFile, 'denied');
      });
      result.deniedMkdir = codeOf(function () {
        fs.mkdirSync(scenario.deniedDir + '/new-dir');
      });
      result.prefixList = codeOf(function () {
        fs.readdirSync(scenario.deniedDir);
      });
      result.prefixWrite = codeOf(function () {
        fs.writeFileSync(scenario.deniedDir + '/prefix.txt', 'denied');
      });

      result.oversizeRead = codeOf(function () {
        fs.readFileSync(readGrant + '/oversize.txt', 'utf8');
      });
      result.oversizeWrite = codeOf(function () {
        fs.writeFileSync(writeGrant + '/oversize.txt', 'x'.repeat(262145));
      });
      result.listLimit = codeOf(function () {
        fs.readdirSync(readGrant + '/many');
      });

      result.selfGrantBlocked =
        hostRequestCode('grant-main-directory',
          { path: scenario.deniedDir, mode: 'readwrite' }) ===
        'ELECTRON_MBT_HOST_REQUEST_DENIED';
      result.fileGrantBlocked =
        hostRequestCode('grant-main-file',
          { path: scenario.deniedFile, mode: 'read' }) ===
        'ELECTRON_MBT_HOST_REQUEST_DENIED';
    } catch (error) {
      result.ok = false;
      result.error = error && error.code ? error.code : String(error);
    }
    if (result.readList !== true || result.readStatDir !== true ||
        result.readStatFile !== true || result.readText !== 'directory-read\n' ||
        result.readExists !== true || result.readAsync !== true ||
        result.readDirent !== true || result.readSymlinkList !== 'EACCES' ||
        result.readSymlinkStat !== 'EACCES' || result.readSymlinkRead !== 'EACCES' ||
        result.readWriteDenied !== 'EACCES' || result.readMkdirDenied !== 'EACCES' ||
        result.readTraversal !== 'EACCES' || result.writeList !== true ||
        result.writeMkdirFirstCreated !== true || result.writeReadBack !== true ||
        result.writeStatDir !== true || result.writeAsync !== true ||
        result.writeAsyncMkdir !== true || result.writeEscapeWrite !== 'EACCES' ||
        result.writeEscapeMkdir !== 'EACCES' || result.writeSymlinkList !== 'EACCES' ||
        result.writeMissingParent !== 'EIO' || result.writeOnlyList !== 'EACCES' ||
        result.writeOnlyStat !== 'EACCES' || result.writeOnlyRead !== 'EACCES' ||
        result.writeOnlyWrite !== 'no-error' || result.writeOnlyReadBack !== 'EACCES' ||
        result.writeOnlyMkdir !== true || result.deniedList !== 'EACCES' ||
        result.deniedStat !== 'EACCES' || result.deniedRead !== 'EACCES' ||
        result.deniedWrite !== 'EACCES' || result.deniedMkdir !== 'EACCES' ||
        result.prefixList !== 'EACCES' || result.prefixWrite !== 'EACCES' ||
        result.oversizeRead !== 'EFBIG' || result.oversizeWrite !== 'EFBIG' ||
        result.listLimit !== 'EFBIG' || result.selfGrantBlocked !== true ||
        result.fileGrantBlocked !== true) {
      result.ok = false;
    }
    return result;
  });
  const window = new BrowserWindow({
    width: 480,
    height: 320,
    title: 'nodeless-directory',
    show: false,
  });
  window.loadFile('index.html');
});
