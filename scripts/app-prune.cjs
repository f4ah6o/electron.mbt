'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { inside } = require('../bridges/node/app-files.cjs');

const SKIP_TOP = new Set(['node_modules', '.git', '.cache', 'coverage']);
const SKIP_PACKAGE = new Set(['.bin', '.cache', '.package-lock.json', 'node_modules']);

function sha256(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

function copyFile(source, destination) {
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
}

function copyTree(sourceRoot, destinationRoot, skipNames, files) {
  const info = fs.lstatSync(sourceRoot);
  if (info.isSymbolicLink()) throw new Error(`symlink is not allowed in the pruned closure: ${sourceRoot}`);
  if (info.isDirectory()) {
    for (const name of fs.readdirSync(sourceRoot).sort()) {
      if (skipNames.has(name)) continue;
      copyTree(path.join(sourceRoot, name), path.join(destinationRoot, name), new Set(), files);
    }
    return;
  }
  if (!info.isFile()) throw new Error(`non-regular file is not allowed: ${sourceRoot}`);
  copyFile(sourceRoot, destinationRoot);
  files.push(destinationRoot);
}

function appFiles(appRoot, outRoot) {
  const files = [];
  for (const name of fs.readdirSync(appRoot).sort()) {
    if (SKIP_TOP.has(name)) continue;
    copyTree(path.join(appRoot, name), path.join(outRoot, name), new Set(), files);
  }
  return files;
}

function canonicalForOverlap(target) {
  const suffix = [];
  let current = path.resolve(target);
  while (!fs.existsSync(current)) {
    suffix.unshift(path.basename(current));
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return path.join(fs.realpathSync(current), ...suffix);
}

function packageNameFromKey(key) {
  const marker = 'node_modules/';
  const at = key.lastIndexOf(marker);
  return at >= 0 ? key.slice(at + marker.length) : key;
}

function pruneApp({ appRoot, outRoot, appId }) {
  const root = fs.realpathSync(appRoot);
  const out = canonicalForOverlap(outRoot);
  if (inside(root, out) || inside(out, root)) throw new Error('output directory must not overlap the app source');
  const packageJsonPath = path.join(root, 'package.json');
  const lockPath = path.join(root, 'package-lock.json');
  if (!fs.existsSync(packageJsonPath)) throw new Error('package.json is required');
  if (!fs.existsSync(lockPath)) throw new Error('package-lock.json is required');
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  if (lock.lockfileVersion !== 3 || !lock.packages || typeof lock.packages !== 'object') {
    throw new Error('package-lock must be lockfileVersion 3 with a packages map');
  }
  const id = appId || packageJson.name;
  if (typeof id !== 'string' || id.length === 0) throw new Error('app id is required');
  if (fs.existsSync(out) && (!fs.statSync(out).isDirectory() || fs.readdirSync(out).length > 0)) {
    throw new Error('output directory must be empty or absent');
  }
  fs.mkdirSync(out, { recursive: true });

  const copiedFiles = appFiles(root, out);
  const packageFiles = [];
  const productionPackages = [];
  const skippedDev = [];
  const missingOptional = [];
  const nativeAddons = [];
  for (const [key, entry] of Object.entries(lock.packages)) {
    if (!key) continue;
    if (entry.link || entry.dev) {
      if (entry.dev) skippedDev.push(key);
      continue;
    }
    const source = path.join(root, key);
    if (!fs.existsSync(source)) {
      if (entry.optional) missingOptional.push(key);
      else throw new Error(`production package is not installed: ${key}`);
    }
    copyTree(source, path.join(out, key), SKIP_PACKAGE, packageFiles);
    productionPackages.push({
      path: key,
      name: packageNameFromKey(key),
      version: entry.version || null,
      optional: entry.optional === true,
      resolved: typeof entry.resolved === 'string' ? entry.resolved : null,
      integrity: typeof entry.integrity === 'string' ? entry.integrity : null,
    });
  }
  for (const file of packageFiles) {
    if (file.endsWith('.node')) nativeAddons.push(path.relative(out, file).split(path.sep).join('/'));
  }
  const hashFiles = (files, base) => {
    const rows = files.map((file) => `${path.relative(base, file).split(path.sep).join('/')}:${sha256(fs.readFileSync(file))}`).sort();
    return sha256(rows.join('\n'));
  };
  const appFileHash = hashFiles(copiedFiles, out);
  const packageFileHash = hashFiles(packageFiles, out);
  const appBytes = copiedFiles.reduce((sum, file) => sum + fs.statSync(file).size, 0);
  const packageBytes = packageFiles.reduce((sum, file) => sum + fs.statSync(file).size, 0);
  const closure = {
    schema: 1,
    status: 'PASS',
    appId: id,
    name: packageJson.name || id,
    version: packageJson.version || '0.0.0',
    packageLockHash: sha256(fs.readFileSync(lockPath)),
    appFileHash,
    packageFileHash,
    appFileCount: copiedFiles.length,
    packageFileCount: packageFiles.length,
    appBytes,
    packageBytes,
    productionPackages,
    excludedDevCount: skippedDev.length,
    missingOptional,
    nativeAddons,
    note: 'Production dependency closure only. No source or package file is modified. The closure is not a signed or reproducible artifact; native addons remain unsupported by the M1/Node-less profiles.',
  };
  fs.writeFileSync(path.join(out, 'closure.json'), `${JSON.stringify(closure, null, 2)}\n`);
  return closure;
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--') || argv[i + 1] === undefined) throw new Error(`invalid argument ${arg}`);
    out[arg.slice(2)] = argv[++i];
  }
  return out;
}

if (require.main === module) {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (!args.app || !args.out) throw new Error('--app and --out are required');
    const closure = pruneApp({ appRoot: args.app, outRoot: args.out, appId: args.id });
    process.stdout.write(`${JSON.stringify({ ok: true, out: path.relative(process.cwd(), path.resolve(args.out)), appId: closure.appId, packages: closure.productionPackages.length, nativeAddons: closure.nativeAddons.length, appFileCount: closure.appFileCount, packageFileCount: closure.packageFileCount })}\n`);
  } catch (error) {
    process.stderr.write(`ELECTRON_MBT_APP_PRUNE: ${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { pruneApp };
