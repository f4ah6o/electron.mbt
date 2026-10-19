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
        result.unknownFlag !== 'ELECTRON_MBT_UNSUPPORTED_API') {
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
