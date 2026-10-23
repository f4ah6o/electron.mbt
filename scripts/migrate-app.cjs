'use strict';
// Node reference implementation of the Electromoon developer commands.
// The native `emoon` CLI mirrors this contract; the JS output is the oracle.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { inspectApp, inside } = require('../bridges/node/app-files.cjs');
const { scanSymbols } = require('./app-inventory.cjs');
const { buildSourceManifest } = require('./source-manifest.cjs');
const { buildAdapter } = require('./adapted-adapter.cjs');

const WORKSPACE = '.emoon';
const LIMITS = Object.freeze({
  files: 4096,
  totalBytes: 64 * 1024 * 1024,
  fileBytes: 16 * 1024 * 1024,
  scanBytes: 4 * 1024 * 1024,
});
const RENDERER_CANDIDATES = ['out/renderer', 'dist/renderer', 'build/renderer'];

function codeError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}
function fail(code, message) { throw codeError(code, message); }
function sha256(data) { return crypto.createHash('sha256').update(data).digest('hex'); }
function readJson(file) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); }
  catch (error) { fail('ELECTRON_MBT_MIGRATE_IO', `cannot read ${file}: ${error.message}`); }
  try { return JSON.parse(text); }
  catch { fail('ELECTRON_MBT_MIGRATE_JSON', `invalid JSON: ${file}`); }
}
function writeJsonAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(temporary, file);
}
function parseArgs(argv) {
  const result = { appDir: '.', positional: [], include: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) { result.positional.push(arg); continue; }
    const key = arg.slice(2);
    if (key === 'force' || key === 'reset-data' || key === 'dry-run' || key === 'json' || key === 'help' || key === 'no-launch') {
      result[key] = true;
      continue;
    }
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) fail('ELECTRON_MBT_MIGRATE_USAGE', `${arg} requires a value`);
    i += 1;
    if (key === 'include') result.include.push(...value.split(',').map(item => item.trim()).filter(Boolean));
    else if (key === 'app-dir') result.appDir = value;
    else result[key] = value;
  }
  if (result.positional.length > 1) fail('ELECTRON_MBT_MIGRATE_USAGE', 'only one app directory is accepted');
  if (result.positional.length === 1) result.appDir = result.positional[0];
  return result;
}
function normalizeRelative(value, label) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 512) fail('ELECTRON_MBT_MIGRATE_USAGE', `${label} is required`);
  if (path.isAbsolute(value) || value.split('/').includes('..') || value.split('\\').includes('..')) {
    fail('ELECTRON_MBT_PATH_ESCAPE', `${label} must be app-relative`);
  }
  return value.split(path.sep).join('/');
}
function resolveInside(root, relative, label) {
  const resolved = path.resolve(root, relative);
  if (!inside(root, resolved)) fail('ELECTRON_MBT_PATH_ESCAPE', `${label} escapes the app root`);
  return resolved;
}
function packageOf(appDir) {
  const root = fs.realpathSync(appDir);
  if (!fs.statSync(root).isDirectory()) fail('ELECTRON_MBT_INVALID_APP', 'app root must be a directory');
  const pkg = readJson(path.join(root, 'package.json'));
  if (typeof pkg.main !== 'string' || pkg.main.length === 0 || path.isAbsolute(pkg.main)) {
    fail('ELECTRON_MBT_INVALID_APP', 'package.json main must be an app-relative path');
  }
  return { root, pkg, main: pkg.main.split(path.sep).join('/') };
}
function detectRenderer(root) {
  for (const candidate of RENDERER_CANDIDATES) {
    const resolved = path.resolve(root, candidate);
    if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) return candidate;
  }
  return null;
}
function stagePath(root, config, options) {
  return path.resolve(root, options.out || path.join(config.workspace, 'app'));
}
function configPath(root, options) {
  return options.config ? path.resolve(root, options.config) : path.join(root, WORKSPACE, 'config.json');
}
function loadConfig(root, options) {
  const file = configPath(root, options);
  if (fs.existsSync(file)) {
    const config = readJson(file);
    if (!config || config.schema !== 1) fail('ELECTRON_MBT_MIGRATE_CONFIG', 'unsupported .emoon/config.json schema');
    const configuredInclude = Array.isArray(config.include) ? config.include.map(value => normalizeRelative(value, 'include')) : [];
    const include = [...new Set([...configuredInclude, ...(options.include || []).map(value => normalizeRelative(value, 'include'))])];
    const api = options.api !== undefined
      ? (options.api ? normalizeRelative(options.api, 'api') : null)
      : (config.api === null || config.api === undefined ? null : normalizeRelative(config.api, 'api'));
    return {
      schema: 1,
      main: normalizeRelative(config.main, 'main'),
      renderer: options.renderer ? normalizeRelative(options.renderer, 'renderer') : normalizeRelative(config.renderer, 'renderer'),
      page: options.page
        ? normalizeRelative(options.page, 'page')
        : normalizeRelative(config.page || `${options.renderer ? normalizeRelative(options.renderer, 'renderer') : normalizeRelative(config.renderer, 'renderer')}/index.html`, 'page'),
      include,
      api,
      configFile: file,
      workspace: path.dirname(file),
    };
  }
  if (!options.renderer) fail('ELECTRON_MBT_MIGRATE_CONFIG', 'no .emoon/config.json; run `emoon init --renderer <dir>` first');
  return {
    schema: 1,
    main: normalizeRelative(packageOf(root).main, 'main'),
    renderer: normalizeRelative(options.renderer, 'renderer'),
    page: options.page ? normalizeRelative(options.page, 'page') : `${normalizeRelative(options.renderer, 'renderer')}/index.html`,
    include: options.include || [],
    api: options.api ? normalizeRelative(options.api, 'api') : null,
    configFile: file,
    workspace: path.join(root, WORKSPACE),
  };
}
function ensureNotSymlink(file) {
  const info = fs.lstatSync(file);
  if (info.isSymbolicLink()) fail('ELECTRON_MBT_MIGRATE_SYMLINK', `symlink is not admitted: ${file}`);
  return info;
}
function collectTree(root, relative, out, limitState) {
  const absolute = resolveInside(root, relative, relative);
  const info = ensureNotSymlink(absolute);
  if (info.isFile()) {
    if (info.size <= 0) return;
    if (info.size > LIMITS.fileBytes) fail('ELECTRON_MBT_MIGRATE_LIMIT', `file exceeds 16 MiB: ${relative}`);
    out.add(relative);
    limitState.files += 1;
    limitState.bytes += info.size;
    if (limitState.files > LIMITS.files || limitState.bytes > LIMITS.totalBytes) fail('ELECTRON_MBT_MIGRATE_LIMIT', 'stage exceeds file or byte limits');
    return;
  }
  if (!info.isDirectory()) fail('ELECTRON_MBT_MIGRATE_TYPE', `not a regular file or directory: ${relative}`);
  for (const name of fs.readdirSync(absolute).sort()) {
    if (name === '.git' || name === '.emoon' || name === 'node_modules/.cache') continue;
    collectTree(root, `${relative}/${name}`, out, limitState);
  }
}
function collectFiles(root, config, options) {
  const files = new Set();
  const state = { files: 0, bytes: 0 };
  files.add('package.json');
  const mainInfo = ensureNotSymlink(resolveInside(root, config.main, 'main'));
  if (!mainInfo.isFile() || mainInfo.size <= 0) fail('ELECTRON_MBT_MIGRATE_TYPE', 'main entry must be a non-empty regular file');
  files.add(config.main);
  state.files += 1;
  state.bytes += mainInfo.size;
  const pageInfo = ensureNotSymlink(resolveInside(root, config.page, 'page'));
  if (!pageInfo.isFile() || pageInfo.size <= 0) fail('ELECTRON_MBT_MIGRATE_TYPE', 'page must be a non-empty regular file');
  files.add(config.page);
  state.files += 1;
  state.bytes += pageInfo.size;
  collectTree(root, config.renderer, files, state);
  for (const include of config.include) collectTree(root, include, files, state);
  // A generated stage must not be admitted into itself.
  const stage = stagePath(root, config, options);
  for (const file of [...files]) {
    if (inside(stage, path.resolve(root, file))) files.delete(file);
  }
  return [...files];
}
function inspectReport(root, pkg, config, options) {
  const app = inspectApp(root);
  const stageRelative = path.relative(root, stagePath(root, config, options)).split(path.sep).join('/');
  const inventory = {
    ...app.inventory,
    files: app.inventory.files.filter(file => file.path !== stageRelative && !file.path.startsWith(`${stageRelative}/`)),
  };
  let symbols;
  try { symbols = scanSymbols(root, inventory, 'original-cjs'); }
  catch (error) { fail('ELECTRON_MBT_MIGRATE_SCAN', error.message); }
  const mainPath = resolveInside(root, config.main, 'main');
  let preloadReferenced = false;
  const info = ensureNotSymlink(mainPath);
  if (info.isFile() && info.size <= 1024 * 1024) {
    preloadReferenced = /\bpreload\s*:/.test(fs.readFileSync(mainPath, 'utf8'));
  }
  const blockers = [];
  if (app.nativeAddons) blockers.push({ code: 'ELECTRON_MBT_MIGRATE_NATIVE_ADDON', message: 'native addons are not supported' });
  if (app.asar) blockers.push({ code: 'ELECTRON_MBT_MIGRATE_ASAR', message: 'ASAR archives are not supported' });
  if (app.entryType !== 'commonjs') blockers.push({ code: 'ELECTRON_MBT_MIGRATE_MODULE_TYPE', message: `entry type ${app.entryType} is not supported` });
  const tier = blockers.length > 0 ? 'blocked' : (preloadReferenced || config.api ? 'adapted' : 'plain');
  const warnings = [];
  if (preloadReferenced && !config.api) warnings.push({ code: 'WARN_PRELOAD_NOT_EXECUTED', message: 'the original preload is not executed; provide --api adapted-preload.json for an adapted build' });
  return {
    schema: 1,
    tool: { name: 'emoon', version: '0.1.0', impl: 'node' },
    command: 'inspect',
    status: 'inspected',
    compatible: false,
    claim: 'not-a-compatibility-result',
    tier,
    source: {
      appDir: root,
      packageName: typeof pkg.name === 'string' ? pkg.name : path.basename(root),
      packageVersion: typeof pkg.version === 'string' ? pkg.version : '0.0.0',
      entry: config.main,
      page: config.page,
      renderer: config.renderer,
    },
    stage: null,
    observations: {
      entryType: app.entryType,
      nativeAddons: app.nativeAddons,
      asar: app.asar,
      preloadReferenced,
      page: config.page,
      api: config.api,
      builtins: symbols.builtins,
      packages: symbols.packages,
      localImports: symbols.localImports,
      scan: { scannedFiles: symbols.scannedFiles, scannedBytes: symbols.scannedBytes, skippedLargeFiles: symbols.skippedLargeFiles, completeness: symbols.completeness },
    },
    blockers,
    warnings,
    generated: [],
    notClaimed: ['compatibility', 'security', 'packaging', 'production consent'],
  };
}
function cliInit(argv) {
  const options = parseArgs(argv);
  const root = fs.realpathSync(options.appDir);
  if (!fs.statSync(root).isDirectory()) fail('ELECTRON_MBT_INVALID_APP', 'app root must be a directory');
  const { pkg, main } = packageOf(root);
  const renderer = options.renderer ? normalizeRelative(options.renderer, 'renderer') : detectRenderer(root);
  if (!renderer) fail('ELECTRON_MBT_MIGRATE_CONFIG', 'could not detect a renderer directory; pass --renderer <dir>');
  const mainPath = resolveInside(root, main, 'main');
  const mainInfo = ensureNotSymlink(mainPath);
  if (!mainInfo.isFile() || mainInfo.size <= 0) fail('ELECTRON_MBT_MIGRATE_CONFIG', 'main must be a non-empty regular file');
  const rendererPath = resolveInside(root, renderer, 'renderer');
  if (!fs.statSync(rendererPath).isDirectory()) fail('ELECTRON_MBT_MIGRATE_CONFIG', 'renderer must be a directory');
  const page = options.page ? normalizeRelative(options.page, 'page') : `${renderer}/index.html`;
  const pagePath = resolveInside(root, page, 'page');
  const pageInfo = ensureNotSymlink(pagePath);
  if (!pageInfo.isFile() || pageInfo.size <= 0) fail('ELECTRON_MBT_MIGRATE_CONFIG', 'page must be a non-empty regular file');
  const include = (options.include || []).map(value => normalizeRelative(value, 'include'));
  for (const item of include) ensureNotSymlink(resolveInside(root, item, 'include'));
  const api = options.api ? normalizeRelative(options.api, 'api') : null;
  if (api && !fs.existsSync(resolveInside(root, api, 'api'))) fail('ELECTRON_MBT_MIGRATE_CONFIG', 'api manifest does not exist');
  const file = configPath(root, options);
  if (fs.existsSync(file) && !options.force) fail('ELECTRON_MBT_MIGRATE_EXISTS', '.emoon/config.json already exists; pass --force to replace it');
  const config = { schema: 1, main, renderer, page, include, api };
  writeJsonAtomic(file, config);
  const gitignore = path.join(path.dirname(file), '.gitignore');
  if (!fs.existsSync(gitignore)) fs.writeFileSync(gitignore, 'app/\n');
  const report = {
    schema: 1,
    tool: { name: 'emoon', version: '0.1.0', impl: 'node' },
    command: 'init',
    status: 'initialized',
    compatible: false,
    claim: 'not-a-compatibility-result',
    config: path.relative(root, file).split(path.sep).join('/'),
    source: { appDir: root, packageName: typeof pkg.name === 'string' ? pkg.name : path.basename(root), entry: main, page, renderer },
    blockers: [],
    notClaimed: ['compatibility', 'security', 'packaging'],
  };
  console.log(JSON.stringify(report));
  return 0;
}
function cliInspect(argv) {
  const options = parseArgs(argv);
  const { root, pkg } = packageOf(options.appDir);
  const config = loadConfig(root, options);
  const report = inspectReport(root, pkg, config, options);
  console.log(JSON.stringify(report));
  return report.tier === 'blocked' ? 2 : 0;
}
function copyFile(root, relative, stage) {
  const source = resolveInside(root, relative, relative);
  const info = ensureNotSymlink(source);
  if (!info.isFile() || info.size <= 0) return null;
  if (info.size > LIMITS.fileBytes) fail('ELECTRON_MBT_MIGRATE_LIMIT', `file exceeds 16 MiB: ${relative}`);
  const destination = resolveInside(stage, relative, relative);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
  fs.chmodSync(destination, info.mode & 0o777);
  return { path: relative, sha256: sha256(fs.readFileSync(destination)), bytes: info.size };
}
function dataPresent(stage) {
  for (const name of ['.appData', '.userData']) {
    const candidate = path.join(stage, name);
    if (fs.existsSync(candidate) && fs.readdirSync(candidate).length > 0) return true;
  }
  return false;
}
function prepareStage(root, config, options) {
  const stage = stagePath(root, config, options);
  if (stage === root || !inside(root, stage)) fail('ELECTRON_MBT_MIGRATE_OUT', 'stage must be inside the app root');
  if (fs.existsSync(stage)) {
    const info = fs.lstatSync(stage);
    if (info.isSymbolicLink()) fail('ELECTRON_MBT_MIGRATE_SYMLINK', 'stage is a symlink');
    if (!options.force) fail('ELECTRON_MBT_MIGRATE_EXISTS', 'stage already exists; pass --force to replace it');
    if (dataPresent(stage) && !options['reset-data']) fail('ELECTRON_MBT_MIGRATE_DATA_PRESENT', 'stage contains app data; pass --reset-data to delete it');
    fs.rmSync(stage, { recursive: true, force: true });
  }
  fs.mkdirSync(stage, { recursive: true });
  return stage;
}
function cliMigrate(argv) {
  const options = parseArgs(argv);
  const { root, pkg } = packageOf(options.appDir);
  const config = loadConfig(root, options);
  const inspected = inspectReport(root, pkg, config, options);
  if (inspected.tier === 'blocked') {
    inspected.command = 'migrate';
    inspected.status = 'blocked';
    console.log(JSON.stringify(inspected));
    return 2;
  }
  const files = collectFiles(root, config, options);
  if (files.length === 0) fail('ELECTRON_MBT_MIGRATE_EMPTY', 'no files to stage');
  if (options['dry-run']) {
    const report = { ...inspected, command: 'migrate', status: 'inspected', stage: { root: path.relative(root, stagePath(root, config, options)).split(path.sep).join('/'), files: files.length, bytes: files.reduce((sum, file) => sum + fs.statSync(path.resolve(root, file)).size, 0), manifestSha256: null } };
    console.log(JSON.stringify(report));
    return 0;
  }
  const stage = prepareStage(root, config, options);
  const generated = [];
  for (const relative of files) {
    const copied = copyFile(root, relative, stage);
    if (copied) generated.push(copied);
  }
  let adapter = null;
  if (config.api) {
    if (!inside(root, path.resolve(root, config.api))) fail('ELECTRON_MBT_PATH_ESCAPE', 'api manifest escapes the app root');
    const apiManifest = readJson(resolveInside(root, config.api, 'api'));
    let built;
    try { built = buildAdapter(apiManifest); }
    catch (error) { fail('ELECTRON_MBT_MIGRATE_ADAPTER', error.message); }
    if (Buffer.byteLength(built.source) > 65536) fail('ELECTRON_MBT_MIGRATE_ADAPTER', 'generated adapter exceeds 64 KiB');
    const adapterRelative = 'adapted/page-api.js';
    fs.mkdirSync(path.join(stage, 'adapted'), { recursive: true });
    fs.writeFileSync(path.join(stage, adapterRelative), built.source);
    fs.writeFileSync(path.join(stage, 'nodeless-app.json'), `${JSON.stringify({ schema: 1, profile: 'electron-nodeless-adapted-v1', adapter: adapterRelative }, null, 2)}\n`);
    files.push(adapterRelative, 'nodeless-app.json');
    generated.push({ path: adapterRelative, sha256: sha256(built.source), bytes: Buffer.byteLength(built.source) });
    generated.push({ path: 'nodeless-app.json', sha256: sha256(fs.readFileSync(path.join(stage, 'nodeless-app.json'))), bytes: fs.statSync(path.join(stage, 'nodeless-app.json')).size });
    adapter = adapterRelative;
  }
  let manifest;
  try { manifest = buildSourceManifest(stage, config.page, typeof pkg.name === 'string' ? pkg.name : path.basename(root), files); }
  catch (error) { fail('ELECTRON_MBT_MIGRATE_MANIFEST', error.message); }
  const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
  fs.writeFileSync(path.join(stage, 'source-manifest.json'), manifestText);
  const manifestSha256 = sha256(manifestText);
  generated.unshift({ path: 'source-manifest.json', sha256: manifestSha256, bytes: Buffer.byteLength(manifestText) });
  const report = {
    ...inspected,
    command: 'migrate',
    status: 'staged',
    tier: config.api ? 'adapted' : 'plain',
    stage: {
      root: path.relative(root, stage).split(path.sep).join('/'),
      files: manifest.files.length,
      bytes: manifest.files.reduce((sum, file) => sum + file.bytes, 0),
      manifestSha256,
    },
    adapted: adapter ? { adapter } : null,
    generated,
    sourceUnchanged: true,
  };
  writeJsonAtomic(path.join(config.workspace, 'migration-report.json'), report);
  console.log(JSON.stringify(report));
  return 0;
}
function main(argv) {
  const command = argv[0];
  if (command === 'init') return cliInit(argv.slice(1));
  if (command === 'inspect') return cliInspect(argv.slice(1));
  if (command === 'migrate') return cliMigrate(argv.slice(1));
  fail('ELECTRON_MBT_MIGRATE_USAGE', 'use init|inspect|migrate');
}
module.exports = { cliInit, cliInspect, cliMigrate, main, parseArgs, LIMITS, WORKSPACE };
if (require.main === module) {
  try { process.exitCode = main(process.argv.slice(2)); }
  catch (error) {
    console.log(JSON.stringify({ ok: false, compatible: false, code: error.code || 'ELECTRON_MBT_MIGRATE_IO', message: error.message }));
    process.exitCode = 1;
  }
}
