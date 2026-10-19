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

app.whenReady().then(function () {
  ipcMain.handle('fs:selftest', async function () {
    const result = { ok: true };
    try {
      result.syncText = fs.readFileSync('sample.txt', 'utf8');
      result.syncBuffer = Buffer.isBuffer(fs.readFileSync('sample.txt'));
      result.asyncText = await fsp.readFile('sample.txt', 'utf8');
      result.exists = fs.existsSync('sample.txt');
      result.existsMissing = fs.existsSync('missing.txt');
      result.existsOutside = fs.existsSync('/etc/passwd');

      const large = 'x'.repeat(200000);
      fs.writeFileSync('.appData/large.txt', large);
      result.largeRead = fs.readFileSync('.appData/large.txt', 'utf8') === large;
      result.largeAsync = (await fsp.readFile('.appData/large.txt', 'utf8')) === large;

      await fsp.writeFile('.appData/async.txt', 'async', 'utf8');
      result.asyncWrite = (await fsp.readFile('.appData/async.txt', 'utf8')) === 'async';

      fs.writeFileSync('.appData/nested/dir/file.txt', 'nested');
      result.nestedWrite = fs.readFileSync('.appData/nested/dir/file.txt', 'utf8') === 'nested';

      fs.writeFileSync('.appData/atomic.txt', 'first');
      fs.writeFileSync('.appData/atomic.txt', 'second');
      result.atomicRead = fs.readFileSync('.appData/atomic.txt', 'utf8') === 'second';

      fs.writeFileSync('.appData/empty.txt', '');
      result.empty = fs.readFileSync('.appData/empty.txt', 'utf8') === '' &&
        fs.existsSync('.appData/empty.txt');

      const encoded = fs.readFileSync('sample.txt', 'base64');
      fs.writeFileSync('.appData/roundtrip.txt', encoded, 'base64');
      result.base64RoundTrip =
        fs.readFileSync('.appData/roundtrip.txt', 'utf8') === 'sample\n';

      // Directory and metadata surface. The test harness pre-creates
      // .appData/sample-link so the symlink classification is deterministic;
      // manual runs without that link simply omit direntLink.
      const firstCreated = fs.mkdirSync('.appData/dir-selftest/nested', { recursive: true });
      const createdSuffix = '/.appData/dir-selftest';
      result.mkdirRecursive = typeof firstCreated === 'string' &&
        firstCreated.length > createdSuffix.length &&
        firstCreated.slice(firstCreated.length - createdSuffix.length) === createdSuffix;
      result.mkdirExistingRecursive =
        fs.mkdirSync('.appData/dir-selftest/nested', { recursive: true }) === undefined;
      fs.writeFileSync('.appData/dir-selftest/nested/a.txt', 'a');
      result.dirListNested = fs.readdirSync('.appData/dir-selftest').length === 1 &&
        fs.readdirSync('.appData/dir-selftest')[0] === 'nested';
      result.dirListSrc = fs.readdirSync('src').length === 1 &&
        fs.readdirSync('src')[0] === 'main.js';
      result.dirListUtf8 = fs.readdirSync('src', 'utf8').length === 1;

      const dirents = fs.readdirSync('.appData/dir-selftest/nested', { withFileTypes: true });
      result.direntFile = dirents.length === 1 && dirents[0].name === 'a.txt' &&
        dirents[0].isFile() === true && dirents[0].isDirectory() === false &&
        typeof dirents[0].parentPath === 'string' && dirents[0].parentPath.length > 0;
      const appDataDirents = fs.readdirSync('.appData', { withFileTypes: true });
      let linkDirent = null;
      for (let i = 0; i < appDataDirents.length; i++) {
        if (appDataDirents[i].name === 'sample-link') linkDirent = appDataDirents[i];
      }
      if (linkDirent !== null) {
        result.direntLink = linkDirent.isSymbolicLink() === true &&
          linkDirent.isFile() === false;
      }

      const fileStats = fs.statSync('.appData/dir-selftest/nested/a.txt');
      result.statFile = fileStats.isFile() === true && fileStats.isDirectory() === false &&
        fileStats.size === 1 && typeof fileStats.mtimeMs === 'number' &&
        fileStats.mtimeMs > 0;
      result.statDirectory = fs.statSync('.appData/dir-selftest').isDirectory() === true;
      result.statMissing = codeOf(function () { fs.statSync('missing.txt'); });
      result.statOutside = codeOf(function () { fs.statSync('/etc/passwd'); });
      result.statNoThrow = fs.statSync('missing.txt', { throwIfNoEntry: false }) === undefined;
      result.statBigint = codeOf(function () {
        fs.statSync('sample.txt', { bigint: true });
      });

      result.listMissing = codeOf(function () { fs.readdirSync('missing.txt'); });
      result.listFile = codeOf(function () { fs.readdirSync('sample.txt'); });
      result.listOutside = codeOf(function () { fs.readdirSync('/etc'); });
      result.listBadEncoding = codeOf(function () { fs.readdirSync('src', 'base64'); });
      result.listRecursive = codeOf(function () { fs.readdirSync('src', { recursive: true }); });

      result.mkdirExists = codeOf(function () { fs.mkdirSync('.appData/dir-selftest'); });
      result.mkdirFile = codeOf(function () {
        fs.mkdirSync('.appData/dir-selftest/nested/a.txt');
      });
      result.mkdirMissingParent = codeOf(function () {
        fs.mkdirSync('.appData/no-parent/child', { recursive: false });
      });
      result.mkdirDenied = codeOf(function () { fs.mkdirSync('src/newdir'); });
      result.mkdirTraversal = codeOf(function () {
        fs.mkdirSync('.appData/../src/newdir');
      });
      result.mkdirMode = codeOf(function () {
        fs.mkdirSync('.appData/mode-dir', { mode: 0o755 });
      });

      const asyncStats = await fsp.stat('sample.txt');
      result.asyncStat = asyncStats.isFile() === true && asyncStats.size === 7;
      const asyncNames = await fsp.readdir('src');
      result.asyncReaddir = asyncNames.length === 1 && asyncNames[0] === 'main.js';
      await fsp.mkdir('.appData/async-dir', { recursive: true });
      result.asyncMkdir = fs.statSync('.appData/async-dir').isDirectory() === true;
      await fsp.mkdir('.userData', { recursive: true });
      result.mkdirDataRoot = fs.statSync('.userData').isDirectory() === true;

      result.escapeListCode = codeOf(function () { fs.readdirSync('.appData/escape'); });
      result.escapeStatCode = codeOf(function () {
        fs.statSync('.appData/escape/secret.txt');
      });

      result.writeDenied = codeOf(function () {
        fs.writeFileSync('src/main.js', 'denied');
      });
      result.traversalDenied = codeOf(function () {
        fs.writeFileSync('.appData/../src/main.js', 'denied');
      });
      result.readDenied = codeOf(function () {
        fs.readFileSync('/etc/passwd');
      });
      result.missing = codeOf(function () {
        fs.readFileSync('missing.txt');
      });
      result.oversize = codeOf(function () {
        fs.writeFileSync('.appData/too-big.txt', 'x'.repeat(262145));
      });
      result.escapeCode = codeOf(function () {
        fs.readFileSync('.appData/escape/secret.txt');
      });
      result.unknownFlag = codeOf(function () {
        fs.writeFileSync('.appData/flag.txt', 'x', { flag: 'a' });
      });
    } catch (error) {
      result.ok = false;
      result.error = error && error.code ? error.code : String(error);
    }
    if (result.syncText !== 'sample\n' || result.asyncText !== 'sample\n' ||
        result.syncBuffer !== true || result.exists !== true ||
        result.existsMissing !== false || result.existsOutside !== false ||
        result.largeRead !== true || result.largeAsync !== true ||
        result.asyncWrite !== true || result.nestedWrite !== true ||
        result.atomicRead !== true || result.empty !== true ||
        result.base64RoundTrip !== true ||
        result.writeDenied !== 'EACCES' || result.traversalDenied !== 'EACCES' ||
        result.readDenied !== 'EACCES' || result.missing !== 'ENOENT' ||
        result.oversize !== 'EFBIG' ||
        result.unknownFlag !== 'ELECTRON_MBT_UNSUPPORTED_API' ||
        result.mkdirRecursive !== true || result.mkdirExistingRecursive !== true ||
        result.dirListNested !== true || result.dirListSrc !== true ||
        result.dirListUtf8 !== true || result.direntFile !== true ||
        (result.direntLink !== undefined && result.direntLink !== true) ||
        result.statFile !== true || result.statDirectory !== true ||
        result.statMissing !== 'ENOENT' || result.statOutside !== 'EACCES' ||
        result.statNoThrow !== true ||
        result.statBigint !== 'ELECTRON_MBT_UNSUPPORTED_API' ||
        result.listMissing !== 'ENOENT' || result.listFile !== 'ENOTDIR' ||
        result.listOutside !== 'EACCES' ||
        result.listBadEncoding !== 'ELECTRON_MBT_UNSUPPORTED_API' ||
        result.listRecursive !== 'ELECTRON_MBT_UNSUPPORTED_API' ||
        result.mkdirExists !== 'EEXIST' || result.mkdirFile !== 'EEXIST' ||
        result.mkdirMissingParent !== 'ENOENT' ||
        result.mkdirDenied !== 'EACCES' || result.mkdirTraversal !== 'EACCES' ||
        result.mkdirMode !== 'ELECTRON_MBT_UNSUPPORTED_API' ||
        result.asyncStat !== true || result.asyncReaddir !== true ||
        result.asyncMkdir !== true || result.mkdirDataRoot !== true ||
        (result.escapeListCode !== 'ENOENT' && result.escapeListCode !== 'EACCES') ||
        (result.escapeStatCode !== 'ENOENT' && result.escapeStatCode !== 'EACCES')) {
      result.ok = false;
    }
    return result;
  });
  const window = new BrowserWindow({
    width: 480,
    height: 320,
    title: 'nodeless-fs',
    show: false,
  });
  window.loadFile('index.html');
});
