'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { TextDecoder } = require('node:util');
const { runtimeError } = require('./errors.cjs');

const MAX_PRELOAD_BYTES = 65536;
function fail(code, message) { throw runtimeError(code, message); }
function readPreload(root, filename) {
  if (typeof filename !== 'string' || !path.isAbsolute(filename) ||
      !filename || filename.includes('\0')) {
    fail('ELECTRON_MBT_PRELOAD_PATH_DENIED', 'Sandbox preload must be an absolute file path');
  }
  let appRoot, real;
  try {
    appRoot = fs.realpathSync(root);
    real = fs.realpathSync(filename);
  } catch {
    fail('ELECTRON_MBT_PRELOAD_PATH_DENIED', 'Preload path cannot be resolved');
  }
  if (!real.startsWith(appRoot + path.sep) || !['.cjs', '.js'].includes(path.extname(real))) {
    fail('ELECTRON_MBT_PRELOAD_PATH_DENIED', 'Preload must be JavaScript under the app root');
  }
  let fd;
  try {
    fd = fs.openSync(real, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    const before = fs.fstatSync(fd);
    if (!before.isFile()) fail('ELECTRON_MBT_PRELOAD_PATH_DENIED', 'Preload must be a regular file');
    if (before.size === 0 || before.size > MAX_PRELOAD_BYTES) {
      fail('ELECTRON_MBT_PRELOAD_LIMIT', 'Preload must be 1..65536 UTF-8 bytes');
    }
    const bytes = fs.readFileSync(fd);
    const after = fs.fstatSync(fd);
    if (bytes.length !== before.size || bytes.length !== after.size ||
        before.ino !== after.ino || before.dev !== after.dev) {
      fail('ELECTRON_MBT_PRELOAD_CHANGED', 'Preload changed during reading');
    }
    let preloadSource;
    try {
      preloadSource = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
    } catch {
      fail('ELECTRON_MBT_PRELOAD_INVALID_ENCODING', 'Invalid UTF-8 preload');
    }
    if (preloadSource.includes('\0') || !preloadSource.isWellFormed()) {
      fail('ELECTRON_MBT_PRELOAD_INVALID_ENCODING', 'Invalid preload source');
    }
    return { preloadSource,
      preloadSHA256: createHash('sha256').update(bytes).digest('hex') };
  } catch (error) {
    if (error?.code?.startsWith('ELECTRON_MBT_')) throw error;
    fail('ELECTRON_MBT_PRELOAD_PATH_DENIED', 'Preload source cannot be read');
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}
module.exports = { readPreload, MAX_PRELOAD_BYTES };
