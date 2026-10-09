'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { createRequire } = require('node:module');
const { runtimeError } = require('./errors.cjs');
const LIMITS = Object.freeze({ entries: 16384, files: 8192, bytes: 268435456, fileBytes: 33554432, packageBytes: 65536, depth: 64 });
function inside(root, target) {
  const relative = path.relative(root, target);
  return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`));
}
function readBounded(file, limit) {
  const flags = fs.constants.O_RDONLY | fs.constants.O_NONBLOCK | (fs.constants.O_NOFOLLOW || 0);
  const fd = fs.openSync(file, flags);
  try {
    const before = fs.fstatSync(fd);
    if (!before.isFile() || before.size > limit) throw runtimeError('ELECTRON_MBT_LIMIT', 'App resource exceeds its read limit');
    // readFile can allocate beyond an earlier stat limit if the file grows concurrently.
    const data = Buffer.allocUnsafe(before.size + 1);
    let offset = 0;
    while (offset < data.length) {
      const count = fs.readSync(fd, data, offset, data.length - offset, null);
      if (count === 0) break;
      offset += count;
    }
    const after = fs.fstatSync(fd), current = fs.statSync(file);
    if (offset !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs || current.ino !== before.ino || current.dev !== before.dev) throw runtimeError('ELECTRON_MBT_APP_CHANGED', 'App resource changed while reading');
    return data.subarray(0, offset);
  } finally { fs.closeSync(fd); }
}
function packageAt(file) {
  const data = readBounded(file, LIMITS.packageBytes);
  let result;
  try { result = JSON.parse(data.toString('utf8')); }
  catch { throw runtimeError('ELECTRON_MBT_INVALID_APP', 'Cannot parse package.json'); }
  if (!result || typeof result !== 'object' || Array.isArray(result)) throw runtimeError('ELECTRON_MBT_INVALID_APP', 'package.json must contain an object');
  return result;
}
function snapshot(appDir) {
  const root = fs.realpathSync(appDir);
  if (!fs.statSync(root).isDirectory()) throw runtimeError('ELECTRON_MBT_INVALID_APP', 'App root must be a directory');
  const files = [], links = [];
  let total = 0, entries = 0;
  function walk(logical, ancestors, depth) {
    if (++entries > LIMITS.entries || depth > LIMITS.depth || files.length >= LIMITS.files) throw runtimeError('ELECTRON_MBT_LIMIT', 'App inventory exceeds traversal limits');
    const real = fs.realpathSync(logical);
    if (!inside(root, real)) throw runtimeError('ELECTRON_MBT_PATH_ESCAPE', 'App resource escapes the app root');
    const info = fs.statSync(real);
    if (fs.lstatSync(logical).isSymbolicLink()) links.push({ path: path.relative(root, logical).split(path.sep).join('/'), target: fs.readlinkSync(logical) });
    if (info.isDirectory()) {
      if (ancestors.has(real)) throw runtimeError('ELECTRON_MBT_SYMLINK_CYCLE', 'App resource contains a directory cycle');
      const next = new Set(ancestors).add(real);
      const names = [], directory = fs.opendirSync(real);
      try {
        let entry;
        while ((entry = directory.readSync()) !== null) {
          if (names.length + entries >= LIMITS.entries) throw runtimeError('ELECTRON_MBT_LIMIT', 'App directory exceeds traversal limits');
          names.push(entry.name);
        }
      } finally { directory.closeSync(); }
      for (const name of names.sort()) walk(path.join(logical, name), next, depth + 1);
    } else if (info.isFile()) {
      if (info.size > LIMITS.fileBytes || total + info.size > LIMITS.bytes) throw runtimeError('ELECTRON_MBT_LIMIT', 'App inventory exceeds byte limits');
      const data = readBounded(real, Math.min(LIMITS.fileBytes, LIMITS.bytes - total));
      const after = fs.statSync(real);
      if (data.length !== info.size || after.size !== info.size || after.mtimeMs !== info.mtimeMs || after.ino !== info.ino) throw runtimeError('ELECTRON_MBT_APP_CHANGED', 'App resource changed while hashing');
      total += data.length;
      const relative = path.relative(root, logical).split(path.sep).join('/');
      const item = { path: relative, bytes: data.length, sha256: crypto.createHash('sha256').update(data).digest('hex') };
      if (fs.lstatSync(logical).isSymbolicLink()) item.linkTarget = path.relative(root, real).split(path.sep).join('/');
      files.push(item);
    } else throw runtimeError('ELECTRON_MBT_INVALID_APP', 'App inventory contains a non-regular resource');
  }
  walk(root, new Set(), 0);
  files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  links.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  return { schema: 1, root, files, links, totalBytes: total, sha256: crypto.createHash('sha256').update(JSON.stringify({ files, links })).digest('hex') };
}
function inspectApp(appDir) {
  const inventory = snapshot(appDir);
  const root = inventory.root;
  const manifest = packageAt(path.join(root, 'package.json'));
  const main = manifest.main === undefined ? 'index.js' : manifest.main;
  if (typeof main !== 'string' || main.length === 0 || main.includes('\0') || path.isAbsolute(main)) throw runtimeError('ELECTRON_MBT_INVALID_APP', 'main must be an app-relative entry');
  const requested = path.resolve(root, main);
  if (!inside(root, requested)) throw runtimeError('ELECTRON_MBT_PATH_ESCAPE', 'Main entry escapes the app root');
  let entry;
  try { entry = fs.realpathSync(createRequire(path.join(root, 'package.json')).resolve(requested)); }
  catch { throw runtimeError('ELECTRON_MBT_ENTRY_MISSING', 'Cannot resolve the app main entry'); }
  if (!inside(root, entry)) throw runtimeError('ELECTRON_MBT_PATH_ESCAPE', 'Resolved main entry escapes the app root');
  let type = 'commonjs';
  if (entry.endsWith('.mjs')) type = 'module';
  else if (!entry.endsWith('.cjs')) {
    if (!entry.endsWith('.js')) type = 'unsupported';
    else {
      for (let current = path.dirname(entry); inside(root, current); current = path.dirname(current)) {
        const candidate = path.join(current, 'package.json');
        if (fs.existsSync(candidate)) { type = packageAt(candidate).type === 'module' ? 'module' : 'commonjs'; break; }
        if (current === root) break;
      }
    }
  }
  return { root, entry, entryType: type, name: typeof manifest.name === 'string' ? manifest.name : path.basename(root),
    version: typeof manifest.version === 'string' ? manifest.version : '0.0.0',
    nativeAddons: inventory.files.some(file => file.path.endsWith('.node')),
    asar: inventory.files.some(file => file.path.endsWith('.asar')), inventory };
}
module.exports = { inspectApp, snapshot, inside, LIMITS };
