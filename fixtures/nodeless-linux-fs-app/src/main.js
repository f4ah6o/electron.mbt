'use strict';
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

app.whenReady().then(function () {
  const settings = path.join(app.getPath('userData'), 'settings.json');
  fs.writeFileSync(settings, '{"ok":true}');
  if (fs.readFileSync(settings, 'utf8') !== '{"ok":true}') {
    throw new Error('userData write/read failed');
  }
  if (!fs.existsSync(settings)) throw new Error('userData stat failed');
  if (fs.readFileSync('sample.txt', 'utf8') !== 'sample\n') {
    throw new Error('app source read failed');
  }
  let readDenied = false;
  try { fs.readFileSync('/etc/passwd'); } catch (error) { readDenied = error.code === 'EACCES'; }
  let writeDenied = false;
  try { fs.writeFileSync('src/main.js', 'denied'); } catch (error) { writeDenied = error.code === 'EACCES'; }
  let traversalDenied = false;
  try { fs.writeFileSync('.userData/../src/main.js', 'denied'); } catch (error) {
    traversalDenied = error.code === 'EACCES';
  }
  let oversize = false;
  try { fs.writeFileSync('.userData/too-big.txt', 'x'.repeat(262145)); } catch (error) {
    oversize = error.code === 'EFBIG';
  }
  let escapeDenied = false;
  try { fs.readFileSync('.userData/escape/secret.txt'); } catch (error) {
    escapeDenied = error.code === 'EACCES';
  }
  if (!readDenied || !writeDenied || !traversalDenied || !oversize || !escapeDenied) {
    throw new Error('linux fs policy selftest failed');
  }
  const window = new BrowserWindow({ width: 480, height: 320, title: 'nodeless-linux-fs' });
  window.loadFile('index.html');
});
